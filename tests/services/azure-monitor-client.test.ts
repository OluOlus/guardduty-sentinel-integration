/**
 * Unit tests for Azure Monitor client with DCR support
 */

import { 
  AzureMonitorClient, 
  createAzureMonitorClient,
  createDcrConfigFromEnv,
  createAzureConfigFromEnv,
  AzureMonitorClientOptions 
} from '../../src/services/azure-monitor-client';
import { 
  AzureMonitorIngestionRequest
} from '../../src/types/azure';
import { AzureConfig, DataCollectionRuleConfig } from '../../src/types/configuration';

// Mock the Azure SDK modules
jest.mock('@azure/monitor-ingestion');
jest.mock('@azure/identity');

const mockUpload = jest.fn();
const mockLogsIngestionClient = jest.fn().mockImplementation(() => ({
  upload: mockUpload
}));

const mockClientSecretCredential = jest.fn();

// Set up mocks
beforeAll(() => {
  const { LogsIngestionClient } = require('@azure/monitor-ingestion');
  const { ClientSecretCredential } = require('@azure/identity');
  
  LogsIngestionClient.mockImplementation(mockLogsIngestionClient);
  ClientSecretCredential.mockImplementation(mockClientSecretCredential);
});

describe('AzureMonitorClient', () => {
  const mockAzureConfig: AzureConfig = {
    tenantId: 'test-tenant-id',
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
    workspaceId: 'test-workspace-id',
    subscriptionId: 'test-subscription-id',
    resourceGroupName: 'test-resource-group'
  };

  const mockDcrConfig: DataCollectionRuleConfig = {
    immutableId: 'dcr-test123',
    streamName: 'Custom-GuardDutyFindings'
  };

  const mockOptions: AzureMonitorClientOptions = {
    azureConfig: mockAzureConfig,
    dcrConfig: mockDcrConfig
  };

  // Mock console.error to suppress error logs during tests
  const originalConsoleError = console.error;

  beforeEach(() => {
    jest.clearAllMocks();
    mockUpload.mockResolvedValue(undefined); // Azure SDK returns void on success
    console.error = jest.fn(); // Mock console.error
  });

  afterAll(() => {
    console.error = originalConsoleError; // Restore console.error
  });

  describe('constructor', () => {
    it('should create client with default endpoint when not provided', () => {
      const client = new AzureMonitorClient(mockOptions);
      
      expect(mockClientSecretCredential).toHaveBeenCalledWith(
        mockAzureConfig.tenantId,
        mockAzureConfig.clientId,
        mockAzureConfig.clientSecret
      );
      
      expect(mockLogsIngestionClient).toHaveBeenCalledWith(
        `https://${mockDcrConfig.immutableId}.ingest.monitor.azure.com`,
        expect.any(Object)
      );
    });

    it('should create client with custom endpoint when provided', () => {
      const customDcrConfig = {
        ...mockDcrConfig,
        endpoint: 'https://custom.endpoint.com'
      };
      
      const client = new AzureMonitorClient({
        ...mockOptions,
        dcrConfig: customDcrConfig
      });
      
      expect(mockLogsIngestionClient).toHaveBeenCalledWith(
        'https://custom.endpoint.com',
        expect.any(Object)
      );
    });

    it('should set default timeout and retry options', () => {
      const client = new AzureMonitorClient(mockOptions);
      expect(client).toBeDefined();
    });

    it('should accept custom timeout and retry options', () => {
      const customOptions = {
        ...mockOptions,
        timeoutMs: 60000,
        enableRetry: false
      };
      
      const client = new AzureMonitorClient(customOptions);
      expect(client).toBeDefined();
    });
  });

  describe('ingestData', () => {
    let client: AzureMonitorClient;

    beforeEach(() => {
      client = new AzureMonitorClient(mockOptions);
    });

    it('should successfully ingest valid data', async () => {
      const request: AzureMonitorIngestionRequest = {
        data: [
          {
            TimeGenerated: new Date().toISOString(),
            FindingId: 'test-finding-1',
            AccountId: '123456789012',
            Region: 'us-east-1',
            Severity: 7.0,
            Type: 'Trojan:EC2/DNSDataExfiltration'
          }
        ],
        streamName: 'Custom-GuardDutyFindings',
        timestamp: new Date()
      };

      const response = await client.ingestData(request);

      expect(mockUpload).toHaveBeenCalledWith(
        mockDcrConfig.immutableId,
        request.streamName,
        expect.arrayContaining([
          expect.objectContaining({
            FindingId: 'test-finding-1',
            AccountId: '123456789012'
          })
        ]),
        expect.objectContaining({
          requestOptions: {
            timeout: 30000
          }
        })
      );

      expect(response.status).toBe('success');
      expect(response.acceptedRecords).toBe(1);
      expect(response.rejectedRecords).toBe(0);
      expect(response.errors).toHaveLength(0);
    });

    it('should add TimeGenerated if missing', async () => {
      const request: AzureMonitorIngestionRequest = {
        data: [
          {
            FindingId: 'test-finding-1',
            AccountId: '123456789012'
          }
        ],
        streamName: 'Custom-GuardDutyFindings',
        timestamp: new Date()
      };

      await client.ingestData(request);

      expect(mockUpload).toHaveBeenCalledWith(
        mockDcrConfig.immutableId,
        request.streamName,
        expect.arrayContaining([
          expect.objectContaining({
            TimeGenerated: expect.any(String),
            FindingId: 'test-finding-1'
          })
        ]),
        expect.any(Object)
      );
    });

    it('should convert Date objects to ISO strings', async () => {
      const testDate = new Date('2023-01-01T12:00:00Z');
      const request: AzureMonitorIngestionRequest = {
        data: [
          {
            TimeGenerated: testDate,
            FindingId: 'test-finding-1'
          }
        ],
        streamName: 'Custom-GuardDutyFindings',
        timestamp: new Date()
      };

      await client.ingestData(request);

      expect(mockUpload).toHaveBeenCalledWith(
        mockDcrConfig.immutableId,
        request.streamName,
        expect.arrayContaining([
          expect.objectContaining({
            TimeGenerated: '2023-01-01T12:00:00.000Z',
            FindingId: 'test-finding-1'
          })
        ]),
        expect.any(Object)
      );
    });

    it('should handle null/undefined values', async () => {
      const request: AzureMonitorIngestionRequest = {
        data: [
          {
            FindingId: 'test-finding-1',
            NullField: null,
            UndefinedField: undefined,
            ValidField: 'valid-value'
          }
        ],
        streamName: 'Custom-GuardDutyFindings',
        timestamp: new Date()
      };

      await client.ingestData(request);

      expect(mockUpload).toHaveBeenCalledWith(
        mockDcrConfig.immutableId,
        request.streamName,
        expect.arrayContaining([
          expect.objectContaining({
            FindingId: 'test-finding-1',
            NullField: '',
            UndefinedField: '',
            ValidField: 'valid-value'
          })
        ]),
        expect.any(Object)
      );
    });

    it('should reject empty data array', async () => {
      const request: AzureMonitorIngestionRequest = {
        data: [],
        streamName: 'Custom-GuardDutyFindings',
        timestamp: new Date()
      };

      const response = await client.ingestData(request);
      expect(response.status).toBe('failed');
      expect(response.errors).toHaveLength(1);
      expect(response.errors![0].message).toBe('Request data cannot be empty');
    });

    it('should reject non-array data', async () => {
      const request: AzureMonitorIngestionRequest = {
        data: {} as any,
        streamName: 'Custom-GuardDutyFindings',
        timestamp: new Date()
      };

      const response = await client.ingestData(request);
      expect(response.status).toBe('failed');
      expect(response.errors).toHaveLength(1);
      expect(response.errors![0].message).toBe('Request data must be a non-empty array');
    });

    it('should reject empty stream name', async () => {
      const request: AzureMonitorIngestionRequest = {
        data: [{ test: 'data' }],
        streamName: '',
        timestamp: new Date()
      };

      const response = await client.ingestData(request);
      expect(response.status).toBe('failed');
      expect(response.errors).toHaveLength(1);
      expect(response.errors![0].message).toBe('Stream name must be a non-empty string');
    });

    it('should reject data exceeding size limit', async () => {
      // Create data that exceeds 30MB limit
      const largeData = Array(1000).fill(null).map((_, i) => ({
        FindingId: `finding-${i}`,
        LargeField: 'x'.repeat(50000) // 50KB per record
      }));

      const request: AzureMonitorIngestionRequest = {
        data: largeData,
        streamName: 'Custom-GuardDutyFindings',
        timestamp: new Date()
      };

      const response = await client.ingestData(request);
      expect(response.status).toBe('failed');
      expect(response.errors).toHaveLength(1);
      expect(response.errors![0].message).toMatch(/exceeds maximum allowed size/);
    });

    it('should handle Azure SDK errors', async () => {
      const azureError = new Error('Azure ingestion failed');
      (azureError as any).code = 'INGESTION_FAILED';
      (azureError as any).statusCode = 400;
      mockUpload.mockRejectedValue(azureError);

      const request: AzureMonitorIngestionRequest = {
        data: [{ test: 'data' }],
        streamName: 'Custom-GuardDutyFindings',
        timestamp: new Date()
      };

      const response = await client.ingestData(request);

      expect(response.status).toBe('failed');
      expect(response.acceptedRecords).toBe(0);
      expect(response.rejectedRecords).toBe(1);
      expect(response.errors).toHaveLength(1);
      expect(response.errors![0].code).toBe('INGESTION_FAILED');
      expect(response.errors![0].message).toBe('Azure ingestion failed');
    });

    it('should handle generic errors', async () => {
      const genericError = new Error('Network timeout');
      mockUpload.mockRejectedValue(genericError);

      const request: AzureMonitorIngestionRequest = {
        data: [{ test: 'data' }],
        streamName: 'Custom-GuardDutyFindings',
        timestamp: new Date()
      };

      const response = await client.ingestData(request);

      expect(response.status).toBe('failed');
      expect(response.errors).toHaveLength(1);
      expect(response.errors![0].code).toBe('INGESTION_ERROR');
      expect(response.errors![0].message).toBe('Network timeout');
    });
  });

  describe('testConnection', () => {
    let client: AzureMonitorClient;

    beforeEach(() => {
      client = new AzureMonitorClient(mockOptions);
    });

    it('should return true for successful connection', async () => {
      const result = await client.testConnection();
      expect(result).toBe(true);
      expect(mockUpload).toHaveBeenCalledWith(
        mockDcrConfig.immutableId,
        mockDcrConfig.streamName,
        expect.arrayContaining([
          expect.objectContaining({
            TestField: 'connectivity-test'
          })
        ]),
        expect.any(Object)
      );
    });

    it('should return false for failed connection', async () => {
      mockUpload.mockRejectedValue(new Error('Connection failed'));
      
      const result = await client.testConnection();
      expect(result).toBe(false);
    });
  });

  describe('getDcrConfig', () => {
    it('should return a copy of DCR configuration', () => {
      const client = new AzureMonitorClient(mockOptions);
      const config = client.getDcrConfig();
      
      expect(config).toEqual(mockDcrConfig);
      expect(config).not.toBe(mockDcrConfig); // Should be a copy
    });
  });

  describe('getEndpoint', () => {
    it('should return default endpoint when not configured', () => {
      const client = new AzureMonitorClient(mockOptions);
      const endpoint = client.getEndpoint();
      
      expect(endpoint).toBe(`https://${mockDcrConfig.immutableId}.ingest.monitor.azure.com`);
    });

    it('should return custom endpoint when configured', () => {
      const customDcrConfig = {
        ...mockDcrConfig,
        endpoint: 'https://custom.endpoint.com'
      };
      
      const client = new AzureMonitorClient({
        ...mockOptions,
        dcrConfig: customDcrConfig
      });
      
      const endpoint = client.getEndpoint();
      expect(endpoint).toBe('https://custom.endpoint.com');
    });
  });
});

describe('createAzureMonitorClient', () => {
  const validOptions: AzureMonitorClientOptions = {
    azureConfig: {
      tenantId: 'test-tenant',
      clientId: 'test-client',
      clientSecret: 'test-secret',
      workspaceId: 'test-workspace',
      subscriptionId: 'test-subscription',
      resourceGroupName: 'test-rg'
    },
    dcrConfig: {
      immutableId: 'dcr-test123',
      streamName: 'Custom-GuardDutyFindings'
    }
  };

  it('should create client with valid configuration', () => {
    const client = createAzureMonitorClient(validOptions);
    expect(client).toBeInstanceOf(AzureMonitorClient);
  });

  it('should throw error for missing Azure tenant ID', () => {
    const invalidOptions = {
      ...validOptions,
      azureConfig: {
        ...validOptions.azureConfig,
        tenantId: ''
      }
    };

    expect(() => createAzureMonitorClient(invalidOptions)).toThrow(
      'Azure configuration must include tenantId, clientId, and clientSecret'
    );
  });

  it('should throw error for missing DCR immutable ID', () => {
    const invalidOptions = {
      ...validOptions,
      dcrConfig: {
        ...validOptions.dcrConfig,
        immutableId: ''
      }
    };

    expect(() => createAzureMonitorClient(invalidOptions)).toThrow(
      'DCR configuration must include immutableId and streamName'
    );
  });
});

describe('createDcrConfigFromEnv', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('should create DCR config from environment variables', () => {
    process.env.AZURE_DCR_IMMUTABLE_ID = 'dcr-test123';
    process.env.AZURE_DCR_STREAM_NAME = 'Custom-GuardDutyFindings';
    process.env.AZURE_DCR_ENDPOINT = 'https://custom.endpoint.com';

    const config = createDcrConfigFromEnv();

    expect(config).toEqual({
      immutableId: 'dcr-test123',
      streamName: 'Custom-GuardDutyFindings',
      endpoint: 'https://custom.endpoint.com'
    });
  });

  it('should create DCR config without endpoint', () => {
    process.env.AZURE_DCR_IMMUTABLE_ID = 'dcr-test123';
    process.env.AZURE_DCR_STREAM_NAME = 'Custom-GuardDutyFindings';

    const config = createDcrConfigFromEnv();

    expect(config).toEqual({
      immutableId: 'dcr-test123',
      streamName: 'Custom-GuardDutyFindings',
      endpoint: undefined
    });
  });

  it('should throw error for missing required environment variables', () => {
    process.env.AZURE_DCR_IMMUTABLE_ID = 'dcr-test123';
    // Missing AZURE_DCR_STREAM_NAME

    expect(() => createDcrConfigFromEnv()).toThrow(
      'Environment variables AZURE_DCR_IMMUTABLE_ID and AZURE_DCR_STREAM_NAME are required'
    );
  });
});

describe('createAzureConfigFromEnv', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('should create Azure config from environment variables', () => {
    process.env.AZURE_TENANT_ID = 'test-tenant';
    process.env.AZURE_CLIENT_ID = 'test-client';
    process.env.AZURE_CLIENT_SECRET = 'test-secret';
    process.env.AZURE_WORKSPACE_ID = 'test-workspace';
    process.env.AZURE_SUBSCRIPTION_ID = 'test-subscription';
    process.env.AZURE_RESOURCE_GROUP_NAME = 'test-rg';

    const config = createAzureConfigFromEnv();

    expect(config).toEqual({
      tenantId: 'test-tenant',
      clientId: 'test-client',
      clientSecret: 'test-secret',
      workspaceId: 'test-workspace',
      subscriptionId: 'test-subscription',
      resourceGroupName: 'test-rg'
    });
  });

  it('should throw error for missing required environment variables', () => {
    process.env.AZURE_TENANT_ID = 'test-tenant';
    // Missing other required variables

    expect(() => createAzureConfigFromEnv()).toThrow(
      'Required Azure environment variables are missing'
    );
  });
});
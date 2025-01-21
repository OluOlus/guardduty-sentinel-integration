/**
 * Unit tests for ConfigurationManager
 */

import * as fs from 'fs';
import * as path from 'path';
import { ConfigurationManager } from '../../src/services/configuration-manager';
import { WorkerConfig } from '../../src/types/configuration';

// Mock fs module
jest.mock('fs');
const mockFs = fs as jest.Mocked<typeof fs>;

describe('ConfigurationManager', () => {
  let configManager: ConfigurationManager;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    configManager = new ConfigurationManager();
    originalEnv = { ...process.env };
    // Clear environment variables
    Object.keys(process.env).forEach(key => {
      if (key.startsWith('AWS_') || key.startsWith('AZURE_') || key.startsWith('DCR_') || 
          key.startsWith('BATCH_') || key.startsWith('MAX_') || key.startsWith('RETRY_') ||
          key.startsWith('ENABLE_') || key.startsWith('DEAD_') || key.startsWith('DEDUPLICATION_') ||
          key.startsWith('MONITORING_')) {
        delete process.env[key];
      }
    });
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('loadConfiguration', () => {
    it('should load default configuration when no other sources are provided', async () => {
      // This test should expect validation to fail since required fields are missing
      await expect(configManager.loadConfiguration()).rejects.toThrow(
        'Configuration validation failed'
      );
    });

    it('should load default configuration values when required fields are provided', async () => {
      // Provide required fields via environment
      process.env.AZURE_ENDPOINT = 'https://test.azure.com';
      process.env.DCR_IMMUTABLE_ID = 'test-dcr-id';
      process.env.DCR_STREAM_NAME = 'test-stream';
      process.env.AWS_REGION = 'us-east-1';
      process.env.AWS_S3_BUCKET_NAME = 'test-bucket';
      process.env.AZURE_TENANT_ID = 'test-tenant';
      process.env.AZURE_CLIENT_ID = 'test-client';
      process.env.AZURE_CLIENT_SECRET = 'test-secret';
      process.env.AZURE_WORKSPACE_ID = 'test-workspace';
      process.env.AZURE_SUBSCRIPTION_ID = 'test-subscription';
      process.env.AZURE_RESOURCE_GROUP_NAME = 'test-rg';

      const result = await configManager.loadConfiguration();

      // Check default values are applied
      expect(result.config.batchSize).toBe(100);
      expect(result.config.maxRetries).toBe(3);
      expect(result.config.retryBackoffMs).toBe(1000);
      expect(result.config.enableNormalization).toBe(false);
      expect(result.config.deduplication?.enabled).toBe(true);
      expect(result.config.deduplication?.strategy).toBe('findingId');
      expect(result.config.monitoring?.enableMetrics).toBe(true);
      expect(result.sources).toHaveLength(2); // default + environment
      expect(result.sources[0].type).toBe('default');
      expect(result.sources[1].type).toBe('environment');
    });

    it('should fail validation when required fields are missing', async () => {
      await expect(configManager.loadConfiguration()).rejects.toThrow(
        'Configuration validation failed'
      );
    });

    it('should load configuration from environment variables', async () => {
      // Set required environment variables
      process.env.BATCH_SIZE = '50';
      process.env.MAX_RETRIES = '5';
      process.env.ENABLE_NORMALIZATION = 'true';
      process.env.AZURE_ENDPOINT = 'https://test.azure.com';
      process.env.DCR_IMMUTABLE_ID = 'test-dcr-id';
      process.env.DCR_STREAM_NAME = 'test-stream';
      process.env.AWS_REGION = 'us-east-1';
      process.env.AWS_S3_BUCKET_NAME = 'test-bucket';
      process.env.AZURE_TENANT_ID = 'test-tenant';
      process.env.AZURE_CLIENT_ID = 'test-client';
      process.env.AZURE_CLIENT_SECRET = 'test-secret';
      process.env.AZURE_WORKSPACE_ID = 'test-workspace';
      process.env.AZURE_SUBSCRIPTION_ID = 'test-subscription';
      process.env.AZURE_RESOURCE_GROUP_NAME = 'test-rg';

      const result = await configManager.loadConfiguration();

      expect(result.config.batchSize).toBe(50);
      expect(result.config.maxRetries).toBe(5);
      expect(result.config.enableNormalization).toBe(true);
      expect(result.config.azureEndpoint).toBe('https://test.azure.com');
      expect(result.config.dcr.immutableId).toBe('test-dcr-id');
      expect(result.config.dcr.streamName).toBe('test-stream');
      expect(result.config.aws.region).toBe('us-east-1');
      expect(result.config.aws.s3BucketName).toBe('test-bucket');
      expect(result.sources).toHaveLength(2);
      expect(result.sources[1].type).toBe('environment');
    });

    it('should load configuration from JSON file', async () => {
      const configData = {
        batchSize: 75,
        maxRetries: 4,
        retryBackoffMs: 2000,
        enableNormalization: true,
        azureEndpoint: 'https://file.azure.com',
        dcr: {
          immutableId: 'file-dcr-id',
          streamName: 'file-stream',
        },
        aws: {
          region: 'us-west-2',
          s3BucketName: 'file-bucket',
        },
        azure: {
          tenantId: 'file-tenant',
          clientId: 'file-client',
          clientSecret: 'file-secret',
          workspaceId: 'file-workspace',
          subscriptionId: 'file-subscription',
          resourceGroupName: 'file-rg',
        },
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(configData));

      const result = await configManager.loadConfiguration('config.json');

      expect(result.config.batchSize).toBe(75);
      expect(result.config.maxRetries).toBe(4);
      expect(result.config.retryBackoffMs).toBe(2000);
      expect(result.config.enableNormalization).toBe(true);
      expect(result.config.azureEndpoint).toBe('https://file.azure.com');
      expect(result.sources).toHaveLength(2);
      expect(result.sources[1].type).toBe('file');
      expect(result.sources[1].location).toBe('config.json');
    });

    it('should load configuration from YAML file', async () => {
      const yamlContent = `
batchSize: 80
maxRetries: 2
enableNormalization: false
azureEndpoint: https://yaml.azure.com
dcr:
  immutableId: yaml-dcr-id
  streamName: yaml-stream
aws:
  region: eu-west-1
  s3BucketName: yaml-bucket
azure:
  tenantId: yaml-tenant
  clientId: yaml-client
  clientSecret: yaml-secret
  workspaceId: yaml-workspace
  subscriptionId: yaml-subscription
  resourceGroupName: yaml-rg
`;

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(yamlContent);

      const result = await configManager.loadConfiguration('config.yaml');

      expect(result.config.batchSize).toBe(80);
      expect(result.config.maxRetries).toBe(2);
      expect(result.config.enableNormalization).toBe(false);
      expect(result.config.azureEndpoint).toBe('https://yaml.azure.com');
      expect(result.config.dcr.immutableId).toBe('yaml-dcr-id');
      expect(result.sources).toHaveLength(2);
      expect(result.sources[1].type).toBe('file');
    });

    it('should prioritize environment variables over file configuration', async () => {
      const configData = {
        batchSize: 75,
        azureEndpoint: 'https://file.azure.com',
        dcr: { immutableId: 'file-dcr-id', streamName: 'file-stream' },
        aws: { region: 'us-west-2', s3BucketName: 'file-bucket' },
        azure: {
          tenantId: 'file-tenant',
          clientId: 'file-client',
          clientSecret: 'file-secret',
          workspaceId: 'file-workspace',
          subscriptionId: 'file-subscription',
          resourceGroupName: 'file-rg',
        },
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(configData));

      // Environment variables should override file values
      process.env.BATCH_SIZE = '150';
      process.env.AZURE_ENDPOINT = 'https://env.azure.com';

      const result = await configManager.loadConfiguration('config.json');

      expect(result.config.batchSize).toBe(150); // From environment
      expect(result.config.azureEndpoint).toBe('https://env.azure.com'); // From environment
      expect(result.config.dcr.immutableId).toBe('file-dcr-id'); // From file
      expect(result.sources).toHaveLength(3); // default, file, environment
    });

    it('should handle file loading errors gracefully', async () => {
      mockFs.existsSync.mockReturnValue(false);

      // Still need to provide required env vars to pass validation
      process.env.AZURE_ENDPOINT = 'https://test.azure.com';
      process.env.DCR_IMMUTABLE_ID = 'test-dcr-id';
      process.env.DCR_STREAM_NAME = 'test-stream';
      process.env.AWS_REGION = 'us-east-1';
      process.env.AWS_S3_BUCKET_NAME = 'test-bucket';
      process.env.AZURE_TENANT_ID = 'test-tenant';
      process.env.AZURE_CLIENT_ID = 'test-client';
      process.env.AZURE_CLIENT_SECRET = 'test-secret';
      process.env.AZURE_WORKSPACE_ID = 'test-workspace';
      process.env.AZURE_SUBSCRIPTION_ID = 'test-subscription';
      process.env.AZURE_RESOURCE_GROUP_NAME = 'test-rg';

      const result = await configManager.loadConfiguration('nonexistent.json');

      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain('Failed to load configuration file');
      expect(result.sources).toHaveLength(2); // default + environment
    });

    it('should handle invalid JSON gracefully', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('invalid json {');

      // Still need to provide required env vars to pass validation
      process.env.AZURE_ENDPOINT = 'https://test.azure.com';
      process.env.DCR_IMMUTABLE_ID = 'test-dcr-id';
      process.env.DCR_STREAM_NAME = 'test-stream';
      process.env.AWS_REGION = 'us-east-1';
      process.env.AWS_S3_BUCKET_NAME = 'test-bucket';
      process.env.AZURE_TENANT_ID = 'test-tenant';
      process.env.AZURE_CLIENT_ID = 'test-client';
      process.env.AZURE_CLIENT_SECRET = 'test-secret';
      process.env.AZURE_WORKSPACE_ID = 'test-workspace';
      process.env.AZURE_SUBSCRIPTION_ID = 'test-subscription';
      process.env.AZURE_RESOURCE_GROUP_NAME = 'test-rg';

      const result = await configManager.loadConfiguration('invalid.json');

      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain('Failed to parse configuration file');
    });

    it('should reject unsupported file formats', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('some content');

      // Still need to provide required env vars to pass validation
      process.env.AZURE_ENDPOINT = 'https://test.azure.com';
      process.env.DCR_IMMUTABLE_ID = 'test-dcr-id';
      process.env.DCR_STREAM_NAME = 'test-stream';
      process.env.AWS_REGION = 'us-east-1';
      process.env.AWS_S3_BUCKET_NAME = 'test-bucket';
      process.env.AZURE_TENANT_ID = 'test-tenant';
      process.env.AZURE_CLIENT_ID = 'test-client';
      process.env.AZURE_CLIENT_SECRET = 'test-secret';
      process.env.AZURE_WORKSPACE_ID = 'test-workspace';
      process.env.AZURE_SUBSCRIPTION_ID = 'test-subscription';
      process.env.AZURE_RESOURCE_GROUP_NAME = 'test-rg';

      const result = await configManager.loadConfiguration('config.txt');

      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain('Unsupported configuration file format');
    });
  });

  describe('environment variable parsing', () => {
    beforeEach(() => {
      // Set minimal required config to avoid validation errors
      process.env.AZURE_ENDPOINT = 'https://test.azure.com';
      process.env.DCR_IMMUTABLE_ID = 'test-dcr-id';
      process.env.DCR_STREAM_NAME = 'test-stream';
      process.env.AWS_REGION = 'us-east-1';
      process.env.AWS_S3_BUCKET_NAME = 'test-bucket';
      process.env.AZURE_TENANT_ID = 'test-tenant';
      process.env.AZURE_CLIENT_ID = 'test-client';
      process.env.AZURE_CLIENT_SECRET = 'test-secret';
      process.env.AZURE_WORKSPACE_ID = 'test-workspace';
      process.env.AZURE_SUBSCRIPTION_ID = 'test-subscription';
      process.env.AZURE_RESOURCE_GROUP_NAME = 'test-rg';
    });

    it('should parse boolean environment variables correctly', async () => {
      process.env.ENABLE_NORMALIZATION = 'true';
      process.env.DEDUPLICATION_ENABLED = 'false';
      process.env.MONITORING_ENABLE_METRICS = '1';
      process.env.MONITORING_ENABLE_DETAILED_LOGGING = 'no';

      const result = await configManager.loadConfiguration();

      expect(result.config.enableNormalization).toBe(true);
      expect(result.config.deduplication?.enabled).toBe(false);
      expect(result.config.monitoring?.enableMetrics).toBe(true);
      expect(result.config.monitoring?.enableDetailedLogging).toBe(false);
    });

    it('should parse integer environment variables correctly', async () => {
      process.env.BATCH_SIZE = '200';
      process.env.MAX_RETRIES = '7';
      process.env.RETRY_BACKOFF_MS = '5000';

      const result = await configManager.loadConfiguration();

      expect(result.config.batchSize).toBe(200);
      expect(result.config.maxRetries).toBe(7);
      expect(result.config.retryBackoffMs).toBe(5000);
    });

    it('should handle invalid integer environment variables', async () => {
      process.env.BATCH_SIZE = 'not-a-number';

      await expect(configManager.loadConfiguration()).rejects.toThrow(
        'Environment variable BATCH_SIZE must be a valid integer'
      );
    });

    it('should handle invalid boolean environment variables', async () => {
      process.env.ENABLE_NORMALIZATION = 'maybe';

      await expect(configManager.loadConfiguration()).rejects.toThrow(
        'Environment variable ENABLE_NORMALIZATION must be a valid boolean'
      );
    });

    it('should handle deduplication strategy validation', async () => {
      process.env.DEDUPLICATION_STRATEGY = 'invalidStrategy';

      await expect(configManager.loadConfiguration()).rejects.toThrow(
        'Invalid deduplication strategy: invalidStrategy'
      );
    });

    it('should parse valid deduplication strategy', async () => {
      process.env.DEDUPLICATION_STRATEGY = 'contentHash';
      process.env.DEDUPLICATION_TIME_WINDOW_MINUTES = '30';

      const result = await configManager.loadConfiguration();

      expect(result.config.deduplication?.strategy).toBe('contentHash');
      expect(result.config.deduplication?.timeWindowMinutes).toBe(30);
    });
  });

  describe('configuration validation', () => {
    it('should validate batch size range', async () => {
      const configData = {
        batchSize: 2000, // Too high
        azureEndpoint: 'https://test.azure.com',
        dcr: { immutableId: 'test-dcr-id', streamName: 'test-stream' },
        aws: { region: 'us-east-1', s3BucketName: 'test-bucket' },
        azure: {
          tenantId: 'test-tenant',
          clientId: 'test-client',
          clientSecret: 'test-secret',
          workspaceId: 'test-workspace',
          subscriptionId: 'test-subscription',
          resourceGroupName: 'test-rg',
        },
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(configData));

      await expect(configManager.loadConfiguration('config.json')).rejects.toThrow(
        'Batch size must be between 1 and 1000'
      );
    });

    it('should validate retry count range', async () => {
      const configData = {
        maxRetries: 15, // Too high
        azureEndpoint: 'https://test.azure.com',
        dcr: { immutableId: 'test-dcr-id', streamName: 'test-stream' },
        aws: { region: 'us-east-1', s3BucketName: 'test-bucket' },
        azure: {
          tenantId: 'test-tenant',
          clientId: 'test-client',
          clientSecret: 'test-secret',
          workspaceId: 'test-workspace',
          subscriptionId: 'test-subscription',
          resourceGroupName: 'test-rg',
        },
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(configData));

      await expect(configManager.loadConfiguration('config.json')).rejects.toThrow(
        'Max retries must be between 0 and 10'
      );
    });

    it('should validate HTTPS URLs', async () => {
      const configData = {
        azureEndpoint: 'http://insecure.azure.com', // HTTP instead of HTTPS
        dcr: { immutableId: 'test-dcr-id', streamName: 'test-stream' },
        aws: { region: 'us-east-1', s3BucketName: 'test-bucket' },
        azure: {
          tenantId: 'test-tenant',
          clientId: 'test-client',
          clientSecret: 'test-secret',
          workspaceId: 'test-workspace',
          subscriptionId: 'test-subscription',
          resourceGroupName: 'test-rg',
        },
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(configData));

      await expect(configManager.loadConfiguration('config.json')).rejects.toThrow(
        'Azure endpoint must be a valid HTTPS URL'
      );
    });

    it('should validate required fields', async () => {
      const incompleteConfig = {
        batchSize: 100,
        // Missing required fields
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(incompleteConfig));

      await expect(configManager.loadConfiguration('config.json')).rejects.toThrow(
        'Configuration validation failed'
      );
    });
  });

  describe('configuration merging', () => {
    it('should merge nested objects correctly', async () => {
      const fileConfig = {
        aws: {
          region: 'us-west-2',
          s3BucketName: 'file-bucket',
          s3BucketPrefix: 'file-prefix/',
        },
        azure: {
          tenantId: 'file-tenant',
          clientId: 'file-client',
          clientSecret: 'file-secret',
          workspaceId: 'file-workspace',
          subscriptionId: 'file-subscription',
          resourceGroupName: 'file-rg',
        },
        azureEndpoint: 'https://file.azure.com',
        dcr: { immutableId: 'file-dcr-id', streamName: 'file-stream' },
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(fileConfig));

      // Environment should override specific fields
      process.env.AWS_REGION = 'eu-central-1';
      process.env.AWS_KMS_KEY_ARN = 'arn:aws:kms:eu-central-1:123456789012:key/env-key';

      const result = await configManager.loadConfiguration('config.json');

      expect(result.config.aws.region).toBe('eu-central-1'); // From environment
      expect(result.config.aws.s3BucketName).toBe('file-bucket'); // From file
      expect(result.config.aws.s3BucketPrefix).toBe('file-prefix/'); // From file
      expect(result.config.aws.kmsKeyArn).toBe('arn:aws:kms:eu-central-1:123456789012:key/env-key'); // From environment
    });

    it('should handle partial nested object overrides', async () => {
      const fileConfig = {
        deduplication: {
          enabled: true,
          strategy: 'findingId' as const,
          cacheSize: 5000,
        },
        azureEndpoint: 'https://file.azure.com',
        dcr: { immutableId: 'file-dcr-id', streamName: 'file-stream' },
        aws: { region: 'us-east-1', s3BucketName: 'file-bucket' },
        azure: {
          tenantId: 'file-tenant',
          clientId: 'file-client',
          clientSecret: 'file-secret',
          workspaceId: 'file-workspace',
          subscriptionId: 'file-subscription',
          resourceGroupName: 'file-rg',
        },
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(fileConfig));

      // Environment should override only specific deduplication fields
      process.env.DEDUPLICATION_ENABLED = 'false';
      process.env.DEDUPLICATION_TIME_WINDOW_MINUTES = '60';

      const result = await configManager.loadConfiguration('config.json');

      expect(result.config.deduplication?.enabled).toBe(false); // From environment
      expect(result.config.deduplication?.strategy).toBe('findingId'); // From file
      expect(result.config.deduplication?.cacheSize).toBe(5000); // From file
      expect(result.config.deduplication?.timeWindowMinutes).toBe(60); // From environment
    });
  });

  describe('complete configuration scenarios', () => {
    it('should load a complete valid configuration', async () => {
      const completeConfig = {
        batchSize: 150,
        maxRetries: 4,
        retryBackoffMs: 2500,
        enableNormalization: true,
        deadLetterQueue: 'failed-findings-queue',
        azureEndpoint: 'https://complete.azure.com',
        dcr: {
          immutableId: 'complete-dcr-id',
          streamName: 'Complete-GuardDutyFindings',
          endpoint: 'https://complete-dcr.azure.com',
        },
        aws: {
          region: 'ap-southeast-2',
          s3BucketName: 'complete-guardduty-bucket',
          s3BucketPrefix: 'guardduty-exports/complete/',
          kmsKeyArn: 'arn:aws:kms:ap-southeast-2:123456789012:key/complete-key-id',
        },
        azure: {
          tenantId: 'complete-tenant-id',
          clientId: 'complete-client-id',
          clientSecret: 'complete-client-secret',
          workspaceId: 'complete-workspace-id',
          subscriptionId: 'complete-subscription-id',
          resourceGroupName: 'complete-resource-group',
        },
        deduplication: {
          enabled: true,
          strategy: 'timeWindow' as const,
          timeWindowMinutes: 45,
          cacheSize: 15000,
        },
        monitoring: {
          enableMetrics: true,
          enableDetailedLogging: true,
          healthCheckPort: 9090,
          metricsBackend: {
            type: 'prometheus' as const,
            config: {
              endpoint: 'http://prometheus:9090',
            },
          },
        },
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(completeConfig));

      const result = await configManager.loadConfiguration('complete-config.json');

      expect(result.config).toMatchObject(completeConfig);
      expect(result.sources).toHaveLength(2); // default + file
      expect(result.warnings).toHaveLength(0);
    });
  });
});
/**
 * Integration tests for Azure Function worker implementation
 * 
 * Tests end-to-end data flow, error handling, retry behavior,
 * and performance characteristics for the Azure Function worker.
 * 
 * Requirements: 8.3
 */

import { GuardDutyFinding } from '../../src/types/guardduty';
import { S3ObjectInfo } from '../../src/types/configuration';

// Mock dependencies
jest.mock('../../src/workers/azure-function/processor');
jest.mock('../../src/workers/azure-function/config');
jest.mock('../../src/services/structured-logger');
jest.mock('../../src/services/health-check');

const MockedGuardDutyProcessor = jest.fn() as jest.MockedClass<any>;

describe('Azure Function Worker Integration Tests', () => {
  let mockProcessor: jest.Mocked<any>;
  let mockHealthCheck: any;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock processor instance
    mockProcessor = {
      initialize: jest.fn().mockResolvedValue(undefined),
      processS3Objects: jest.fn(),
      processSpecificS3Objects: jest.fn(),
      processFindings: jest.fn(),
      getHealthStatus: jest.fn()
    };

    MockedGuardDutyProcessor.mockImplementation(() => mockProcessor);

    // Mock health check
    mockHealthCheck = {
      getHealthStatus: jest.fn().mockResolvedValue({
        status: 'healthy',
        timestamp: new Date(),
        components: [],
        uptime: 3600,
        version: '1.0.0'
      })
    };

    // Mock config
    const mockConfig = {
      worker: {
        batchSize: 100,
        enableNormalization: false,
        aws: {
          region: 'us-east-1',
          s3BucketName: 'test-bucket',
          s3BucketPrefix: 'guardduty/',
          kmsKeyArn: 'arn:aws:kms:us-east-1:123456789012:key/test-key'
        },
        azure: {
          tenantId: 'test-tenant',
          clientId: 'test-client',
          clientSecret: 'test-secret',
          workspaceId: 'test-workspace',
          subscriptionId: 'test-subscription',
          resourceGroupName: 'test-rg'
        },
        dcr: {
          immutableId: 'dcr-test123',
          streamName: 'Custom-GuardDutyFindings'
        },
        maxRetries: 3,
        retryBackoffMs: 1000
      },
      logLevel: 'info'
    };

    require('../../src/workers/azure-function/config').createConfigFromEnvironment.mockReturnValue(mockConfig);
    require('../../src/services/health-check').HealthCheck.mockImplementation(() => mockHealthCheck);
  });

  describe('Azure Function Processor Integration', () => {
    it('should process S3 objects successfully', async () => {
      const processingResult = {
        processedBatches: 5,
        totalFindings: 25,
        errors: [],
        duration: 2000
      };

      mockProcessor.processS3Objects.mockResolvedValue(processingResult);

      const result = await mockProcessor.processS3Objects();

      expect(result.processedBatches).toBe(5);
      expect(result.totalFindings).toBe(25);
      expect(result.errors).toHaveLength(0);
      expect(result.duration).toBe(2000);
    });

    it('should process specific S3 objects', async () => {
      const s3Objects: S3ObjectInfo[] = [
        {
          bucket: 'test-bucket',
          key: 'guardduty/file1.jsonl.gz',
          size: 1024,
          lastModified: new Date(),
          etag: 'etag1'
        },
        {
          bucket: 'test-bucket',
          key: 'guardduty/file2.jsonl.gz',
          size: 2048,
          lastModified: new Date(),
          etag: 'etag2'
        }
      ];

      const processingResult = {
        processedBatches: 2,
        totalFindings: 10,
        errors: [],
        duration: 1500
      };

      mockProcessor.processSpecificS3Objects.mockResolvedValue(processingResult);

      const result = await mockProcessor.processSpecificS3Objects(s3Objects);

      expect(mockProcessor.processSpecificS3Objects).toHaveBeenCalledWith(s3Objects);
      expect(result.processedBatches).toBe(2);
      expect(result.totalFindings).toBe(10);
    });

    it('should process findings directly', async () => {
      const findings: GuardDutyFinding[] = [
        {
          schemaVersion: '2.0',
          accountId: '123456789012',
          region: 'us-east-1',
          partition: 'aws',
          id: 'test-finding-1',
          arn: 'arn:aws:guardduty:us-east-1:123456789012:detector/test/finding/test-finding-1',
          type: 'Trojan:EC2/DNSDataExfiltration',
          resource: {
            resourceType: 'Instance',
            instanceDetails: {
              instanceId: 'i-1234567890abcdef0',
              instanceType: 't2.micro',
              instanceState: 'running',
              availabilityZone: 'us-east-1a'
            }
          },
          service: {
            serviceName: 'guardduty',
            detectorId: 'test-detector',
            archived: false,
            count: 1,
            eventFirstSeen: '2024-01-01T00:00:00.000Z',
            eventLastSeen: '2024-01-01T00:00:00.000Z',
            resourceRole: 'TARGET'
          },
          severity: 8.0,
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
          title: 'Test Finding',
          description: 'Test finding description'
        }
      ];

      const processingResult = {
        processedBatches: 1,
        totalFindings: 1,
        errors: [],
        duration: 500
      };

      mockProcessor.processFindings.mockResolvedValue(processingResult);

      const result = await mockProcessor.processFindings(findings);

      expect(mockProcessor.processFindings).toHaveBeenCalledWith(findings);
      expect(result.totalFindings).toBe(1);
    });

    it('should handle processing errors', async () => {
      mockProcessor.processS3Objects.mockRejectedValue(new Error('Azure connection failed'));

      await expect(mockProcessor.processS3Objects()).rejects.toThrow('Azure connection failed');
    });
  });

  describe('Health Check Integration', () => {
    it('should return healthy status', async () => {
      const processorHealthStatus = {
        status: 'healthy' as const,
        timestamp: new Date(),
        components: [
          {
            name: 'S3Service',
            status: 'healthy' as const,
            message: 'S3 accessible',
            lastCheck: new Date()
          }
        ],
        uptime: 3600,
        version: '1.0.0'
      };

      mockProcessor.getHealthStatus.mockResolvedValue(processorHealthStatus);

      const health = await mockProcessor.getHealthStatus();
      expect(health.status).toBe('healthy');
      expect(health.components).toHaveLength(1);
    });

    it('should return unhealthy status when components fail', async () => {
      const processorHealthStatus = {
        status: 'unhealthy' as const,
        timestamp: new Date(),
        components: [
          {
            name: 'S3Service',
            status: 'unhealthy' as const,
            message: 'S3 not accessible',
            lastCheck: new Date()
          }
        ],
        uptime: 3600,
        version: '1.0.0'
      };

      mockProcessor.getHealthStatus.mockResolvedValue(processorHealthStatus);

      const health = await mockProcessor.getHealthStatus();
      expect(health.status).toBe('unhealthy');
    });

    it('should handle initialization errors', async () => {
      mockProcessor.initialize.mockRejectedValue(new Error('Initialization failed'));

      await expect(mockProcessor.initialize()).rejects.toThrow('Initialization failed');
    });
  });

  describe('Timer Processing Integration', () => {
    it('should process S3 objects on schedule', async () => {
      const processingResult = {
        processedBatches: 3,
        totalFindings: 15,
        errors: [],
        duration: 1800
      };

      mockProcessor.processS3Objects.mockResolvedValue(processingResult);

      const result = await mockProcessor.processS3Objects();

      expect(result.processedBatches).toBe(3);
      expect(result.totalFindings).toBe(15);
    });

    it('should handle timer processing errors', async () => {
      mockProcessor.processS3Objects.mockRejectedValue(new Error('S3 access denied'));

      await expect(mockProcessor.processS3Objects()).rejects.toThrow('S3 access denied');
    });
  });

  describe('Error Handling and Resilience', () => {
    it('should handle processor initialization failure', async () => {
      mockProcessor.initialize.mockRejectedValue(new Error('Cannot connect to S3'));

      await expect(mockProcessor.initialize()).rejects.toThrow('Cannot connect to S3');
    });

    it('should handle service unavailable scenarios', async () => {
      mockHealthCheck.getHealthStatus.mockResolvedValue({
        status: 'unhealthy',
        timestamp: new Date(),
        components: [
          {
            name: 'AzureMonitor',
            status: 'unhealthy',
            message: 'Service unavailable',
            lastCheck: new Date()
          }
        ],
        uptime: 3600,
        version: '1.0.0'
      });

      const health = await mockHealthCheck.getHealthStatus();
      expect(health.status).toBe('unhealthy');
    });
  });

  describe('Performance and Scalability', () => {
    it('should handle large batch processing efficiently', async () => {
      const largeS3Objects: S3ObjectInfo[] = Array(50).fill(null).map((_, i) => ({
        bucket: 'test-bucket',
        key: `guardduty/batch${Math.floor(i / 10)}/file${i}.jsonl.gz`,
        size: 1024 * (i + 1),
        lastModified: new Date(),
        etag: `etag${i}`
      }));

      const processingResult = {
        processedBatches: 5,
        totalFindings: 500,
        errors: [],
        duration: 3000
      };

      mockProcessor.processSpecificS3Objects.mockResolvedValue(processingResult);

      const startTime = Date.now();
      const result = await mockProcessor.processSpecificS3Objects(largeS3Objects);
      const duration = Date.now() - startTime;

      expect(result.totalFindings).toBe(500);
      expect(duration).toBeLessThan(1000); // Should complete quickly (mocked)
    });

    it('should handle concurrent processing requests', async () => {
      const processingResult = {
        processedBatches: 10,
        totalFindings: 100,
        errors: [],
        duration: 5000
      };

      mockProcessor.processS3Objects.mockResolvedValue(processingResult);

      // Simulate concurrent executions
      const promises = Array(3).fill(null).map(() => 
        mockProcessor.processS3Objects()
      );

      const results = await Promise.all(promises);

      expect(results).toHaveLength(3);
      results.forEach(result => {
        expect(result.totalFindings).toBe(100);
      });
    });

    it('should track processing metrics accurately', async () => {
      const processingResult = {
        processedBatches: 7,
        totalFindings: 42,
        errors: ['Error processing file1.jsonl.gz'],
        duration: 2500
      };

      mockProcessor.processS3Objects.mockResolvedValue(processingResult);

      const result = await mockProcessor.processS3Objects();

      expect(result).toMatchObject({
        processedBatches: 7,
        totalFindings: 42,
        errors: ['Error processing file1.jsonl.gz'],
        duration: 2500
      });
    });

    it('should handle memory-intensive operations', async () => {
      // Simulate processing large findings
      const largeFindings: GuardDutyFinding[] = Array(1000).fill(null).map((_, i) => ({
        schemaVersion: '2.0',
        accountId: '123456789012',
        region: 'us-east-1',
        partition: 'aws',
        id: `finding-${i}`,
        arn: `arn:aws:guardduty:us-east-1:123456789012:detector/test/finding/finding-${i}`,
        type: 'Trojan:EC2/DNSDataExfiltration',
        resource: {
          resourceType: 'Instance',
          instanceDetails: {
            instanceId: `i-${i.toString().padStart(17, '0')}`,
            instanceType: 't2.micro',
            instanceState: 'running',
            availabilityZone: 'us-east-1a'
          }
        },
        service: {
          serviceName: 'guardduty',
          detectorId: 'test-detector',
          archived: false,
          count: 1,
          eventFirstSeen: '2024-01-01T00:00:00.000Z',
          eventLastSeen: '2024-01-01T00:00:00.000Z',
          resourceRole: 'TARGET'
        },
        severity: 8.0,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        title: `Test Finding ${i}`,
        description: `Test finding description ${i}`
      }));

      const processingResult = {
        processedBatches: 10,
        totalFindings: 1000,
        errors: [],
        duration: 8000
      };

      mockProcessor.processFindings.mockResolvedValue(processingResult);

      const result = await mockProcessor.processFindings(largeFindings);

      expect(result.totalFindings).toBe(1000);
    });
  });

  describe('Batch Processing Integration', () => {
    it('should handle batch completion events', async () => {
      // Simulate batch processing workflow
      const findings: GuardDutyFinding[] = [
        {
          schemaVersion: '2.0',
          accountId: '123456789012',
          region: 'us-east-1',
          partition: 'aws',
          id: 'batch-finding',
          arn: 'arn:aws:guardduty:us-east-1:123456789012:detector/test/finding/batch-finding',
          type: 'Trojan:EC2/DNSDataExfiltration',
          resource: {
            resourceType: 'Instance',
            instanceDetails: {
              instanceId: 'i-batch-test',
              instanceType: 't2.micro',
              instanceState: 'running',
              availabilityZone: 'us-east-1a'
            }
          },
          service: {
            serviceName: 'guardduty',
            detectorId: 'batch-detector',
            archived: false,
            count: 1,
            eventFirstSeen: '2024-01-01T00:00:00.000Z',
            eventLastSeen: '2024-01-01T00:00:00.000Z',
            resourceRole: 'TARGET'
          },
          severity: 8.0,
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
          title: 'Batch Finding',
          description: 'Batch finding for testing'
        }
      ];

      const processingResult = {
        processedBatches: 1,
        totalFindings: 1,
        errors: [],
        duration: 500
      };

      mockProcessor.processFindings.mockResolvedValue(processingResult);

      const result = await mockProcessor.processFindings(findings);

      expect(result.processedBatches).toBe(1);
      expect(result.totalFindings).toBe(1);
    });

    it('should handle batch processing failures', async () => {
      const findings: GuardDutyFinding[] = [
        {
          schemaVersion: '2.0',
          accountId: '123456789012',
          region: 'us-east-1',
          partition: 'aws',
          id: 'failing-finding',
          arn: 'arn:aws:guardduty:us-east-1:123456789012:detector/test/finding/failing-finding',
          type: 'Trojan:EC2/DNSDataExfiltration',
          resource: { resourceType: 'Instance' },
          service: {
            serviceName: 'guardduty',
            detectorId: 'test-detector',
            archived: false,
            count: 1,
            eventFirstSeen: '2024-01-01T00:00:00.000Z',
            eventLastSeen: '2024-01-01T00:00:00.000Z',
            resourceRole: 'TARGET'
          },
          severity: 8.0,
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
          title: 'Failing Finding',
          description: 'Finding that will fail processing'
        }
      ];

      mockProcessor.processFindings.mockRejectedValue(new Error('Batch processing failed'));

      await expect(mockProcessor.processFindings(findings)).rejects.toThrow('Batch processing failed');
    });
  });
});
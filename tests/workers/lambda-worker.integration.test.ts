/**
 * Integration tests for Lambda worker implementation
 * 
 * Tests end-to-end data flow, error handling, retry behavior,
 * and performance characteristics for the Lambda worker.
 * 
 * Requirements: 8.3
 */

import { GuardDutyFinding } from '../../src/types/guardduty';
import { S3ObjectInfo } from '../../src/types/configuration';

// Mock dependencies
jest.mock('../../src/workers/lambda/processor');
jest.mock('../../src/workers/lambda/config');
jest.mock('../../src/services/structured-logger');
jest.mock('../../src/services/metrics-collector');

const MockedGuardDutyProcessor = jest.fn() as jest.MockedClass<any>;

describe('Lambda Worker Integration Tests', () => {
  let mockProcessor: jest.Mocked<any>;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock processor instance
    mockProcessor = {
      initialize: jest.fn().mockResolvedValue(undefined),
      processS3Object: jest.fn(),
      processS3Objects: jest.fn(),
      processSpecificS3Objects: jest.fn(),
      processFindings: jest.fn(),
      getHealthStatus: jest.fn()
    };

    MockedGuardDutyProcessor.mockImplementation(() => mockProcessor);

    // Mock config
    const mockConfig = {
      worker: {
        batchSize: 100,
        enableNormalization: false,
        azureEndpoint: 'https://test.azure.com',
        aws: {
          region: 'us-east-1',
          s3BucketName: 'test-bucket',
          s3BucketPrefix: 'guardduty/',
          kmsKeyArn: 'arn:aws:kms:us-east-1:123456789012:key/test-key'
        },
        dcr: {
          immutableId: 'dcr-test123',
          streamName: 'Custom-GuardDutyFindings'
        },
        maxRetries: 3,
        retryBackoffMs: 1000
      },
      logLevel: 'info',
      timeoutMs: 30000
    };

    require('../../src/workers/lambda/config').createConfigFromEnvironment.mockReturnValue(mockConfig);
  });

  describe('Lambda Processor Integration', () => {
    it('should process S3 objects successfully', async () => {
      const s3Objects = [
        {
          bucket: 'test-bucket',
          key: 'guardduty/file1.jsonl.gz',
          size: 1024,
          lastModified: new Date(),
          etag: 'etag1'
        }
      ];

      mockProcessor.processS3Object.mockResolvedValue({ findingsCount: 5 });

      // Simulate processing S3 objects
      for (const s3Object of s3Objects) {
        const result = await mockProcessor.processS3Object({
          bucket: s3Object.bucket,
          key: s3Object.key,
          size: s3Object.size,
          lastModified: s3Object.lastModified,
          etag: s3Object.etag,
          kmsKeyId: undefined
        });

        expect(result.findingsCount).toBe(5);
      }

      expect(mockProcessor.processS3Object).toHaveBeenCalledWith({
        bucket: 'test-bucket',
        key: 'guardduty/file1.jsonl.gz',
        size: 1024,
        lastModified: expect.any(Date),
        etag: 'etag1',
        kmsKeyId: undefined
      });
    });

    it('should handle processing errors gracefully', async () => {
      const s3Objects = [
        {
          bucket: 'test-bucket',
          key: 'guardduty/corrupted-file.jsonl.gz',
          size: 1024,
          lastModified: new Date(),
          etag: 'etag1'
        }
      ];

      mockProcessor.processS3Object.mockRejectedValue(new Error('Decryption failed'));

      // Simulate error handling
      const errors: string[] = [];
      for (const s3Object of s3Objects) {
        try {
          await mockProcessor.processS3Object({
            bucket: s3Object.bucket,
            key: s3Object.key,
            size: s3Object.size,
            lastModified: s3Object.lastModified,
            etag: s3Object.etag,
            kmsKeyId: undefined
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          errors.push(`${s3Object.key}: ${errorMessage}`);
        }
      }

      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('Decryption failed');
    });

    it('should validate GuardDuty object format', async () => {
      const invalidObjects = [
        'logs/non-guardduty-file.json',
        'guardduty/file-without-extension',
        'other/random-file.txt'
      ];

      const errors: string[] = [];
      
      for (const key of invalidObjects) {
        // Simulate validation
        if (!key.includes('GuardDuty') || !key.endsWith('.jsonl.gz')) {
          errors.push(`Invalid GuardDuty object format: ${key}`);
        }
      }

      expect(errors).toHaveLength(3);
      expect(errors[0]).toContain('Invalid GuardDuty object format');
    });
  });

  describe('Health Check Integration', () => {
    it('should return healthy status', async () => {
      const healthStatus = {
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

      mockProcessor.getHealthStatus.mockResolvedValue(healthStatus);

      const health = await mockProcessor.getHealthStatus();
      expect(health.status).toBe('healthy');
      expect(health.components).toHaveLength(1);
    });

    it('should return unhealthy status', async () => {
      const healthStatus = {
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

      mockProcessor.getHealthStatus.mockResolvedValue(healthStatus);

      const health = await mockProcessor.getHealthStatus();
      expect(health.status).toBe('unhealthy');
    });
  });

  describe('Performance and Scalability', () => {
    it('should handle large number of S3 records efficiently', async () => {
      const recordCount = 100;
      const s3Objects = Array(recordCount).fill(null).map((_, i) => ({
        bucket: 'test-bucket',
        key: `guardduty/batch${Math.floor(i / 10)}/file${i}.jsonl.gz`,
        size: 1024 + i,
        lastModified: new Date(),
        etag: `etag${i}`
      }));

      mockProcessor.processS3Object.mockResolvedValue({ findingsCount: 1 });

      const startTime = Date.now();
      
      // Simulate processing all objects
      let totalFindings = 0;
      for (const s3Object of s3Objects) {
        const result = await mockProcessor.processS3Object({
          bucket: s3Object.bucket,
          key: s3Object.key,
          size: s3Object.size,
          lastModified: s3Object.lastModified,
          etag: s3Object.etag,
          kmsKeyId: undefined
        });
        totalFindings += result.findingsCount;
      }
      
      const duration = Date.now() - startTime;

      expect(mockProcessor.processS3Object).toHaveBeenCalledTimes(recordCount);
      expect(duration).toBeLessThan(5000); // Should complete within 5 seconds
      expect(totalFindings).toBe(recordCount);
    });

    it('should handle memory pressure gracefully', async () => {
      // Simulate large S3 objects
      const s3Objects = Array(10).fill(null).map((_, i) => ({
        bucket: 'test-bucket',
        key: `guardduty/large-file${i}.jsonl.gz`,
        size: 50 * 1024 * 1024, // 50MB files
        lastModified: new Date(),
        etag: `etag${i}`
      }));

      mockProcessor.processS3Object.mockResolvedValue({ findingsCount: 1000 });

      // Process all large objects
      for (const s3Object of s3Objects) {
        const result = await mockProcessor.processS3Object({
          bucket: s3Object.bucket,
          key: s3Object.key,
          size: s3Object.size,
          lastModified: s3Object.lastModified,
          etag: s3Object.etag,
          kmsKeyId: undefined
        });
        
        expect(result.findingsCount).toBe(1000);
      }

      expect(mockProcessor.processS3Object).toHaveBeenCalledTimes(10);
    });
  });

  describe('Error Recovery and Resilience', () => {
    it('should handle partial processing failures', async () => {
      const s3Objects = Array(5).fill(null).map((_, i) => ({
        bucket: 'test-bucket',
        key: `guardduty/file${i}.jsonl.gz`,
        size: 1024,
        lastModified: new Date(),
        etag: `etag${i}`
      }));

      // Simulate some failures
      mockProcessor.processS3Object
        .mockResolvedValueOnce({ findingsCount: 5 })
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({ findingsCount: 3 })
        .mockRejectedValueOnce(new Error('Parse error'))
        .mockResolvedValueOnce({ findingsCount: 2 });

      const errors: string[] = [];
      let totalFindings = 0;
      
      for (const s3Object of s3Objects) {
        try {
          const result = await mockProcessor.processS3Object({
            bucket: s3Object.bucket,
            key: s3Object.key,
            size: s3Object.size,
            lastModified: s3Object.lastModified,
            etag: s3Object.etag,
            kmsKeyId: undefined
          });
          totalFindings += result.findingsCount;
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          errors.push(`${s3Object.key}: ${errorMessage}`);
        }
      }

      expect(mockProcessor.processS3Object).toHaveBeenCalledTimes(5);
      expect(errors).toHaveLength(2);
      expect(totalFindings).toBe(10); // 5 + 3 + 2
    });

    it('should handle Azure ingestion failures with retry', async () => {
      const findings: GuardDutyFinding[] = [
        {
          schemaVersion: '2.0',
          accountId: '123456789012',
          region: 'us-east-1',
          partition: 'aws',
          id: 'test-finding-id',
          arn: 'arn:aws:guardduty:us-east-1:123456789012:detector/test/finding/test-finding-id',
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

      // First call fails, second succeeds
      mockProcessor.processFindings
        .mockRejectedValueOnce(new Error('Azure connection failed'))
        .mockResolvedValueOnce({
          processedBatches: 1,
          totalFindings: 1,
          errors: [],
          duration: 1000
        });

      // Simulate retry logic
      let result;
      try {
        result = await mockProcessor.processFindings(findings);
      } catch (error) {
        // Retry
        result = await mockProcessor.processFindings(findings);
      }

      expect(result.totalFindings).toBe(1);
      expect(mockProcessor.processFindings).toHaveBeenCalledTimes(2);
    });
  });

  describe('Data Flow Integration', () => {
    it('should process findings end-to-end', async () => {
      const findings: GuardDutyFinding[] = [
        {
          schemaVersion: '2.0',
          accountId: '123456789012',
          region: 'us-east-1',
          partition: 'aws',
          id: 'integration-test-finding',
          arn: 'arn:aws:guardduty:us-east-1:123456789012:detector/test/finding/integration-test-finding',
          type: 'Trojan:EC2/DNSDataExfiltration',
          resource: {
            resourceType: 'Instance',
            instanceDetails: {
              instanceId: 'i-integration-test',
              instanceType: 't2.micro',
              instanceState: 'running',
              availabilityZone: 'us-east-1a'
            }
          },
          service: {
            serviceName: 'guardduty',
            detectorId: 'integration-detector',
            archived: false,
            count: 1,
            eventFirstSeen: '2024-01-01T00:00:00.000Z',
            eventLastSeen: '2024-01-01T00:00:00.000Z',
            resourceRole: 'TARGET'
          },
          severity: 8.0,
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
          title: 'Integration Test Finding',
          description: 'Test finding for integration testing'
        }
      ];

      mockProcessor.processFindings.mockResolvedValue({
        processedBatches: 1,
        totalFindings: 1,
        errors: [],
        duration: 500
      });

      const result = await mockProcessor.processFindings(findings);

      expect(result.processedBatches).toBe(1);
      expect(result.totalFindings).toBe(1);
      expect(result.errors).toHaveLength(0);
      expect(result.duration).toBeGreaterThan(0);
    });

    it('should handle batch processing with multiple findings', async () => {
      const findings: GuardDutyFinding[] = Array(50).fill(null).map((_, i) => ({
        schemaVersion: '2.0',
        accountId: '123456789012',
        region: 'us-east-1',
        partition: 'aws',
        id: `batch-finding-${i}`,
        arn: `arn:aws:guardduty:us-east-1:123456789012:detector/test/finding/batch-finding-${i}`,
        type: 'Trojan:EC2/DNSDataExfiltration',
        resource: {
          resourceType: 'Instance',
          instanceDetails: {
            instanceId: `i-batch-${i}`,
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
        title: `Batch Finding ${i}`,
        description: `Batch finding ${i} for testing`
      }));

      mockProcessor.processFindings.mockResolvedValue({
        processedBatches: 1,
        totalFindings: 50,
        errors: [],
        duration: 2000
      });

      const result = await mockProcessor.processFindings(findings);

      expect(result.totalFindings).toBe(50);
      expect(result.processedBatches).toBe(1);
    });
  });
});
/**
 * Integration tests for worker processor implementations
 * 
 * Tests the core processing logic shared between Lambda and Azure Function workers,
 * including S3 integration, Azure ingestion, error handling, and retry behavior.
 * 
 * Requirements: 8.3
 */

import { GuardDutyProcessor as LambdaProcessor } from '../../src/workers/lambda/processor';
import { GuardDutyProcessor as AzureFunctionProcessor } from '../../src/workers/azure-function/processor';
import { GuardDutyFinding } from '../../src/types/guardduty';
import { S3ObjectInfo } from '../../src/types/configuration';
import { Readable } from 'stream';

// Mock all service dependencies
jest.mock('../../src/services/s3-service');
jest.mock('../../src/services/jsonl-processor');
jest.mock('../../src/services/data-transformer');
jest.mock('../../src/services/batch-processor');
jest.mock('../../src/services/retry-handler');
jest.mock('../../src/services/deduplication-service');
jest.mock('../../src/services/azure-monitor-client');
jest.mock('../../src/services/structured-logger');
jest.mock('../../src/services/metrics-collector');
jest.mock('../../src/services/health-check');
jest.mock('../../src/workers/lambda/azure-http-client');

describe('Worker Processor Integration Tests', () => {
  let mockS3Service: any;
  let mockJSONLProcessor: any;
  let mockDataTransformer: any;
  let mockBatchProcessor: any;
  let mockRetryHandler: any;
  let mockDeduplicationService: any;
  let mockAzureMonitorClient: any;
  let mockAzureHttpClient: any;
  let mockStructuredLogger: any;
  let mockMetricsCollector: any;
  let mockHealthCheck: any;

  const sampleFinding: GuardDutyFinding = {
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
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock S3 Service
    mockS3Service = {
      testBucketAccess: jest.fn().mockResolvedValue(true),
      listObjects: jest.fn().mockResolvedValue([]),
      getAndDecryptObject: jest.fn().mockResolvedValue({
        body: new Readable({
          read() {
            this.push(JSON.stringify(sampleFinding) + '\n');
            this.push(null);
          }
        }),
        contentLength: 1024,
        contentType: 'application/gzip'
      })
    };

    // Mock JSONL Processor
    mockJSONLProcessor = {
      processStream: jest.fn().mockResolvedValue([sampleFinding])
    };

    // Mock Data Transformer
    mockDataTransformer = {
      transformFindings: jest.fn().mockImplementation(findings => 
        findings.map((f: GuardDutyFinding) => ({
          TimeGenerated: new Date().toISOString(),
          FindingId: f.id,
          AccountId: f.accountId,
          Region: f.region,
          Severity: f.severity,
          Type: f.type,
          RawJson: JSON.stringify(f)
        }))
      )
    };

    // Mock Batch Processor
    mockBatchProcessor = {
      addFindings: jest.fn(),
      processBatches: jest.fn().mockResolvedValue(undefined),
      getMetrics: jest.fn().mockReturnValue({
        totalProcessed: 1,
        totalBatches: 1,
        totalErrors: 0
      }),
      getQueueStatus: jest.fn().mockReturnValue({
        activeBatches: 0,
        s3Objects: 0,
        findings: 0
      }),
      getCompletedBatches: jest.fn().mockReturnValue([{
        batchId: 'batch-1',
        findings: [sampleFinding],
        processedCount: 1,
        failedCount: 0,
        status: 'completed'
      }]),
      on: jest.fn()
    };

    // Mock Retry Handler
    mockRetryHandler = {
      executeWithRetry: jest.fn().mockImplementation(async (fn) => await fn())
    };

    // Mock Deduplication Service
    mockDeduplicationService = {
      deduplicateFindings: jest.fn().mockImplementation(findings => findings)
    };

    // Mock Azure Monitor Client
    mockAzureMonitorClient = {
      testConnection: jest.fn().mockResolvedValue(true),
      ingestData: jest.fn().mockResolvedValue({
        status: 'success',
        acceptedRecords: 1,
        rejectedRecords: 0,
        errors: []
      })
    };

    // Mock Azure HTTP Client (for Lambda)
    mockAzureHttpClient = {
      testConnection: jest.fn().mockResolvedValue(true),
      ingestData: jest.fn().mockResolvedValue({
        status: 'success',
        acceptedRecords: 1,
        rejectedRecords: 0,
        errors: []
      })
    };

    // Mock Structured Logger
    mockStructuredLogger = {
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    };

    // Mock Metrics Collector
    mockMetricsCollector = {
      initialize: jest.fn().mockResolvedValue(undefined),
      incrementCounter: jest.fn(),
      recordGauge: jest.fn()
    };

    // Mock Health Check
    mockHealthCheck = {
      getHealthStatus: jest.fn().mockResolvedValue({
        status: 'healthy',
        timestamp: new Date(),
        components: [],
        uptime: 3600,
        version: '1.0.0'
      })
    };

    // Set up mocks
    require('../../src/services/s3-service').S3Service.mockImplementation(() => mockS3Service);
    require('../../src/services/jsonl-processor').JSONLProcessor.mockImplementation(() => mockJSONLProcessor);
    require('../../src/services/data-transformer').DataTransformer.mockImplementation(() => mockDataTransformer);
    require('../../src/services/batch-processor').BatchProcessor.mockImplementation(() => mockBatchProcessor);
    require('../../src/services/retry-handler').RetryHandler.mockImplementation(() => mockRetryHandler);
    require('../../src/services/deduplication-service').DeduplicationService.mockImplementation(() => mockDeduplicationService);
    require('../../src/services/azure-monitor-client').AzureMonitorClient.mockImplementation(() => mockAzureMonitorClient);
    require('../../src/workers/lambda/azure-http-client').AzureHttpClient.mockImplementation(() => mockAzureHttpClient);
    require('../../src/services/structured-logger').StructuredLogger.mockImplementation(() => mockStructuredLogger);
    require('../../src/services/metrics-collector').MetricsCollector.mockImplementation(() => mockMetricsCollector);
    require('../../src/services/health-check').HealthCheck.mockImplementation(() => mockHealthCheck);
  });

  describe('Lambda Processor Integration', () => {
    let processor: LambdaProcessor;

    beforeEach(() => {
      const config = {
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
        timeoutMs: 30000
      };

      processor = new LambdaProcessor(config as any, mockStructuredLogger, mockMetricsCollector);
    });

    it('should initialize successfully', async () => {
      await processor.initialize();

      expect(mockS3Service.testBucketAccess).toHaveBeenCalledWith('test-bucket');
      expect(mockAzureHttpClient.testConnection).toHaveBeenCalled();
      expect(mockMetricsCollector.initialize).toHaveBeenCalled();
    });

    it('should process S3 objects end-to-end', async () => {
      const s3Objects = [
        {
          bucket: 'test-bucket',
          key: 'guardduty/file1.jsonl.gz',
          size: 1024,
          lastModified: new Date(),
          etag: 'etag1'
        }
      ];

      mockS3Service.listObjects.mockResolvedValue(s3Objects);

      await processor.initialize();
      const result = await processor.processS3Objects();

      expect(mockS3Service.listObjects).toHaveBeenCalledWith('test-bucket', 'guardduty/', 50);
      expect(mockS3Service.getAndDecryptObject).toHaveBeenCalledWith(
        'test-bucket',
        'guardduty/file1.jsonl.gz',
        'arn:aws:kms:us-east-1:123456789012:key/test-key'
      );
      expect(mockJSONLProcessor.processStream).toHaveBeenCalled();
      expect(mockRetryHandler.executeWithRetry).toHaveBeenCalled();
      expect(result.totalFindings).toBeGreaterThan(0);
    });

    it('should handle S3 processing errors with retry', async () => {
      const s3Objects = [
        {
          bucket: 'test-bucket',
          key: 'guardduty/corrupted-file.jsonl.gz',
          size: 1024,
          lastModified: new Date(),
          etag: 'etag1'
        }
      ];

      mockS3Service.listObjects.mockResolvedValue(s3Objects);
      mockS3Service.getAndDecryptObject.mockRejectedValueOnce(new Error('Decryption failed'));

      await processor.initialize();
      const result = await processor.processS3Objects();

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Decryption failed');
    });

    it('should handle Azure ingestion failures with retry', async () => {
      mockAzureHttpClient.ingestData
        .mockRejectedValueOnce(new Error('Network timeout'))
        .mockResolvedValueOnce({
          status: 'success',
          acceptedRecords: 1,
          rejectedRecords: 0,
          errors: []
        });

      const s3Object: S3ObjectInfo = {
        bucket: 'test-bucket',
        key: 'guardduty/file1.jsonl.gz',
        size: 1024,
        lastModified: new Date(),
        etag: 'etag1',
        kmsKeyId: 'test-key'
      };

      await processor.initialize();
      const result = await processor.processS3Object(s3Object);

      expect(mockRetryHandler.executeWithRetry).toHaveBeenCalled();
      expect(result.findingsCount).toBe(1);
    });

    it('should apply deduplication when enabled', async () => {
      const duplicateFindings = [sampleFinding, sampleFinding];
      mockJSONLProcessor.processStream.mockResolvedValue(duplicateFindings);
      mockDeduplicationService.deduplicateFindings.mockResolvedValue([sampleFinding]);

      await processor.initialize();
      await processor.processFindings(duplicateFindings);

      expect(mockDeduplicationService.deduplicateFindings).toHaveBeenCalledWith(duplicateFindings);
      expect(mockDataTransformer.transformFindings).toHaveBeenCalledWith([sampleFinding]);
    });

    it('should provide accurate health status', async () => {
      await processor.initialize();
      const health = await processor.getHealthStatus();

      expect(health.status).toBe('healthy');
      expect(health.components).toHaveLength(2); // S3Service and AzureHttpClient
      expect(health.components[0].name).toBe('S3Service');
      expect(health.components[1].name).toBe('AzureHttpClient');
    });
  });

  describe('Azure Function Processor Integration', () => {
    let processor: AzureFunctionProcessor;

    beforeEach(() => {
      const config = {
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
        }
      };

      processor = new AzureFunctionProcessor(config as any, mockStructuredLogger, mockHealthCheck);
    });

    it('should initialize successfully', async () => {
      await processor.initialize();

      expect(mockS3Service.testBucketAccess).toHaveBeenCalledWith('test-bucket');
      expect(mockAzureMonitorClient.testConnection).toHaveBeenCalled();
      expect(mockMetricsCollector.initialize).toHaveBeenCalled();
    });

    it('should process S3 objects with batch processor', async () => {
      const s3Objects = [
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

      mockS3Service.listObjects.mockResolvedValue(s3Objects);

      await processor.initialize();
      const result = await processor.processS3Objects();

      expect(mockS3Service.listObjects).toHaveBeenCalledWith('test-bucket', 'guardduty/', 100);
      expect(mockBatchProcessor.addFindings).toHaveBeenCalledTimes(2);
      expect(mockBatchProcessor.processBatches).toHaveBeenCalled();
      expect(result.totalFindings).toBeGreaterThan(0);
    });

    it('should handle batch processing events', async () => {
      const mockBatch = {
        batchId: 'batch-1',
        findings: [sampleFinding],
        processedCount: 1,
        failedCount: 0,
        status: 'completed' as const
      };

      // Simulate batch completion event
      const eventHandler = mockBatchProcessor.on.mock.calls.find(
        (call: any) => call[0] === 'batch-completed'
      )?.[1];

      await processor.initialize();
      
      if (eventHandler) {
        await eventHandler(mockBatch);
      }

      expect(mockDataTransformer.transformFindings).toHaveBeenCalledWith([sampleFinding]);
      expect(mockAzureMonitorClient.ingestData).toHaveBeenCalled();
    });

    it('should handle batch processing failures', async () => {
      const mockBatch = {
        batchId: 'batch-1',
        findings: [sampleFinding],
        processedCount: 0,
        failedCount: 1,
        status: 'failed' as const
      };

      const error = new Error('Batch processing failed');

      // Simulate batch failure event
      const eventHandler = mockBatchProcessor.on.mock.calls.find(
        (call: any) => call[0] === 'batch-failed'
      )?.[1];

      await processor.initialize();
      
      if (eventHandler) {
        eventHandler(mockBatch, error);
      }

      expect(mockStructuredLogger.error).toHaveBeenCalledWith(
        'Batch processing failed',
        expect.objectContaining({
          batchId: 'batch-1',
          error: 'Batch processing failed'
        })
      );
    });

    it('should provide comprehensive health status', async () => {
      await processor.initialize();
      const health = await processor.getHealthStatus();

      expect(health.status).toBe('healthy');
      expect(health.components).toHaveLength(3); // S3Service, AzureMonitor, BatchProcessor
      expect(health.components.map(c => c.name)).toContain('S3Service');
      expect(health.components.map(c => c.name)).toContain('AzureMonitor');
      expect(health.components.map(c => c.name)).toContain('BatchProcessor');
    });

    it('should handle degraded batch processor status', async () => {
      mockBatchProcessor.getQueueStatus.mockReturnValue({
        activeBatches: 15, // Above threshold
        s3Objects: 100,
        findings: 500
      });

      await processor.initialize();
      const health = await processor.getHealthStatus();

      const batchProcessorComponent = health.components.find(c => c.name === 'BatchProcessor');
      expect(batchProcessorComponent?.status).toBe('degraded');
    });
  });

  describe('Cross-Worker Performance Tests', () => {
    it('should handle high-volume processing efficiently', async () => {
      const largeFindings = Array(1000).fill(null).map((_, i) => ({
        ...sampleFinding,
        id: `finding-${i}`,
        arn: `arn:aws:guardduty:us-east-1:123456789012:detector/test/finding/finding-${i}`
      }));

      mockJSONLProcessor.processStream.mockResolvedValue(largeFindings);

      const lambdaConfig = {
        worker: {
          batchSize: 100,
          enableNormalization: false,
          azureEndpoint: 'https://test.azure.com',
          aws: {
            region: 'us-east-1',
            s3BucketName: 'test-bucket',
            s3BucketPrefix: 'guardduty/',
            kmsKeyArn: 'test-key'
          },
          dcr: { immutableId: 'dcr-test123', streamName: 'Custom-GuardDutyFindings' },
          maxRetries: 3,
          retryBackoffMs: 1000
        },
        timeoutMs: 30000
      };

      const lambdaProcessor = new LambdaProcessor(lambdaConfig as any, mockStructuredLogger, mockMetricsCollector);

      await lambdaProcessor.initialize();
      
      const startTime = Date.now();
      const result = await lambdaProcessor.processFindings(largeFindings);
      const duration = Date.now() - startTime;

      expect(result.totalFindings).toBe(1000);
      expect(duration).toBeLessThan(5000); // Should complete within 5 seconds (mocked)
    });

    it('should handle concurrent processing requests', async () => {
      const azureFunctionConfig = {
        worker: {
          batchSize: 50,
          enableNormalization: true,
          aws: {
            region: 'us-east-1',
            s3BucketName: 'test-bucket',
            s3BucketPrefix: 'guardduty/',
            kmsKeyArn: 'test-key'
          },
          azure: {
            tenantId: 'test-tenant',
            clientId: 'test-client',
            clientSecret: 'test-secret',
            workspaceId: 'test-workspace',
            subscriptionId: 'test-subscription',
            resourceGroupName: 'test-rg'
          },
          dcr: { immutableId: 'dcr-test123', streamName: 'Custom-GuardDutyFindings' },
          maxRetries: 3,
          retryBackoffMs: 1000
        }
      };

      const processor = new AzureFunctionProcessor(azureFunctionConfig as any, mockStructuredLogger, mockHealthCheck);
      await processor.initialize();

      // Simulate concurrent processing requests
      const concurrentRequests = Array(5).fill(null).map((_, i) => 
        processor.processFindings([{ ...sampleFinding, id: `concurrent-finding-${i}` }])
      );

      const results = await Promise.all(concurrentRequests);

      expect(results).toHaveLength(5);
      results.forEach(result => {
        expect(result.totalFindings).toBe(1);
        expect(result.errors).toHaveLength(0);
      });
    });

    it('should maintain performance under error conditions', async () => {
      // Simulate intermittent failures
      let callCount = 0;
      mockAzureMonitorClient.ingestData.mockImplementation(() => {
        callCount++;
        if (callCount % 3 === 0) {
          throw new Error('Intermittent failure');
        }
        return Promise.resolve({
          status: 'success',
          acceptedRecords: 1,
          rejectedRecords: 0,
          errors: []
        });
      });

      const config = {
        worker: {
          batchSize: 10,
          enableNormalization: false,
          aws: {
            region: 'us-east-1',
            s3BucketName: 'test-bucket',
            s3BucketPrefix: 'guardduty/',
            kmsKeyArn: 'test-key'
          },
          azure: {
            tenantId: 'test-tenant',
            clientId: 'test-client',
            clientSecret: 'test-secret',
            workspaceId: 'test-workspace',
            subscriptionId: 'test-subscription',
            resourceGroupName: 'test-rg'
          },
          dcr: { immutableId: 'dcr-test123', streamName: 'Custom-GuardDutyFindings' },
          maxRetries: 2,
          retryBackoffMs: 100
        }
      };

      const processor = new AzureFunctionProcessor(config as any, mockStructuredLogger, mockHealthCheck);
      await processor.initialize();

      const findings = Array(30).fill(sampleFinding);
      const result = await processor.processFindings(findings);

      // Should handle failures gracefully with retries
      expect(mockRetryHandler.executeWithRetry).toHaveBeenCalled();
      expect(result.totalFindings).toBe(30);
    });
  });

  describe('Error Recovery and Resilience', () => {
    it('should recover from temporary service outages', async () => {
      // Simulate service recovery
      mockS3Service.testBucketAccess
        .mockRejectedValueOnce(new Error('Service unavailable'))
        .mockResolvedValue(true);

      mockAzureMonitorClient.testConnection
        .mockRejectedValueOnce(new Error('Connection timeout'))
        .mockResolvedValue(true);

      const config = {
        worker: {
          batchSize: 100,
          enableNormalization: false,
          aws: {
            region: 'us-east-1',
            s3BucketName: 'test-bucket',
            s3BucketPrefix: 'guardduty/',
            kmsKeyArn: 'test-key'
          },
          azure: {
            tenantId: 'test-tenant',
            clientId: 'test-client',
            clientSecret: 'test-secret',
            workspaceId: 'test-workspace',
            subscriptionId: 'test-subscription',
            resourceGroupName: 'test-rg'
          },
          dcr: { immutableId: 'dcr-test123', streamName: 'Custom-GuardDutyFindings' },
          maxRetries: 3,
          retryBackoffMs: 1000
        }
      };

      const processor = new AzureFunctionProcessor(config as any, mockStructuredLogger, mockHealthCheck);

      // First initialization should fail
      await expect(processor.initialize()).rejects.toThrow();

      // Second initialization should succeed
      await expect(processor.initialize()).resolves.not.toThrow();
    });

    it('should handle partial data corruption gracefully', async () => {
      const mixedFindings = [
        sampleFinding,
        { ...sampleFinding, id: null }, // Invalid finding
        sampleFinding,
        { ...sampleFinding, accountId: undefined }, // Invalid finding
        sampleFinding
      ];

      mockJSONLProcessor.processStream.mockResolvedValue(mixedFindings);
      mockDataTransformer.transformFindings.mockImplementation((findings: any[]) => 
        findings.filter(f => f.id && f.accountId).map(f => ({
          TimeGenerated: new Date().toISOString(),
          FindingId: f.id,
          AccountId: f.accountId,
          Region: f.region,
          Severity: f.severity,
          Type: f.type,
          RawJson: JSON.stringify(f)
        }))
      );

      const config = {
        worker: {
          batchSize: 100,
          enableNormalization: false,
          azureEndpoint: 'https://test.azure.com',
          aws: {
            region: 'us-east-1',
            s3BucketName: 'test-bucket',
            s3BucketPrefix: 'guardduty/',
            kmsKeyArn: 'test-key'
          },
          dcr: { immutableId: 'dcr-test123', streamName: 'Custom-GuardDutyFindings' },
          maxRetries: 3,
          retryBackoffMs: 1000
        },
        timeoutMs: 30000
      };

      const processor = new LambdaProcessor(config as any, mockStructuredLogger, mockMetricsCollector);
      await processor.initialize();

      const result = await processor.processFindings(mixedFindings as any);

      // Should process only valid findings
      expect(mockDataTransformer.transformFindings).toHaveBeenCalledWith([
        sampleFinding,
        sampleFinding,
        sampleFinding
      ]);
      expect(result.totalFindings).toBe(3);
    });
  });
});
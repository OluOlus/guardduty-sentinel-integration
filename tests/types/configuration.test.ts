/**
 * Unit tests for configuration type definitions
 */

import { WorkerConfig, ProcessingBatch, RetryPolicy } from '../../src/types/configuration';

describe('Configuration Types', () => {
  describe('WorkerConfig', () => {
    it('should accept a valid worker configuration', () => {
      const config: WorkerConfig = {
        batchSize: 100,
        maxRetries: 3,
        retryBackoffMs: 1000,
        enableNormalization: false,
        azureEndpoint: 'https://test-endpoint.azure.com',
        dcr: {
          immutableId: 'dcr-test-id',
          streamName: 'Custom-GuardDutyFindings',
        },
        aws: {
          region: 'us-east-1',
          s3BucketName: 'test-guardduty-bucket',
        },
        azure: {
          tenantId: 'test-tenant-id',
          clientId: 'test-client-id',
          clientSecret: 'test-client-secret',
          workspaceId: 'test-workspace-id',
          subscriptionId: 'test-subscription-id',
          resourceGroupName: 'test-rg',
        },
      };

      expect(config.batchSize).toBe(100);
      expect(config.dcr.streamName).toBe('Custom-GuardDutyFindings');
      expect(config.aws.region).toBe('us-east-1');
      expect(config.azure.tenantId).toBe('test-tenant-id');
    });

    it('should handle optional configuration fields', () => {
      const config: WorkerConfig = {
        batchSize: 50,
        maxRetries: 5,
        retryBackoffMs: 2000,
        enableNormalization: true,
        azureEndpoint: 'https://test-endpoint.azure.com',
        dcr: {
          immutableId: 'dcr-test-id',
          streamName: 'Custom-GuardDutyFindings',
          endpoint: 'https://custom-endpoint.azure.com',
        },
        aws: {
          region: 'us-west-2',
          s3BucketName: 'test-guardduty-bucket',
          s3BucketPrefix: 'guardduty-exports/',
          kmsKeyArn: 'arn:aws:kms:us-west-2:123456789012:key/test-key-id',
        },
        azure: {
          tenantId: 'test-tenant-id',
          clientId: 'test-client-id',
          clientSecret: 'test-client-secret',
          workspaceId: 'test-workspace-id',
          subscriptionId: 'test-subscription-id',
          resourceGroupName: 'test-rg',
        },
        deadLetterQueue: 'test-dlq',
        deduplication: {
          enabled: true,
          strategy: 'findingId',
          cacheSize: 10000,
        },
        monitoring: {
          enableMetrics: true,
          enableDetailedLogging: true,
          healthCheckPort: 8080,
        },
      };

      expect(config.deadLetterQueue).toBe('test-dlq');
      expect(config.deduplication?.strategy).toBe('findingId');
      expect(config.monitoring?.healthCheckPort).toBe(8080);
    });
  });

  describe('ProcessingBatch', () => {
    it('should create a valid processing batch', () => {
      const batch: ProcessingBatch = {
        batchId: 'batch-123',
        s3Objects: [
          {
            bucket: 'test-bucket',
            key: 'test-key.jsonl.gz',
            size: 1024,
            lastModified: new Date('2024-01-01T00:00:00.000Z'),
            etag: 'test-etag',
          },
        ],
        findings: [],
        processedCount: 0,
        failedCount: 0,
        retryCount: 0,
        status: 'pending',
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
        updatedAt: new Date('2024-01-01T00:00:00.000Z'),
      };

      expect(batch.batchId).toBe('batch-123');
      expect(batch.status).toBe('pending');
      expect(batch.s3Objects).toHaveLength(1);
      expect(batch.s3Objects[0].bucket).toBe('test-bucket');
    });

    it('should handle batch with error details', () => {
      const batch: ProcessingBatch = {
        batchId: 'batch-456',
        s3Objects: [],
        findings: [],
        processedCount: 5,
        failedCount: 2,
        retryCount: 1,
        status: 'failed',
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
        updatedAt: new Date('2024-01-01T00:05:00.000Z'),
        error: {
          code: 'AZURE_INGESTION_FAILED',
          message: 'Failed to ingest data to Azure Monitor',
          timestamp: new Date('2024-01-01T00:05:00.000Z'),
          details: {
            httpStatusCode: 429,
            retryAfter: 60,
          },
        },
      };

      expect(batch.status).toBe('failed');
      expect(batch.error?.code).toBe('AZURE_INGESTION_FAILED');
      expect(batch.error?.details?.httpStatusCode).toBe(429);
    });
  });

  describe('RetryPolicy', () => {
    it('should define a valid retry policy', () => {
      const policy: RetryPolicy = {
        maxRetries: 3,
        initialBackoffMs: 1000,
        maxBackoffMs: 30000,
        backoffMultiplier: 2,
        enableJitter: true,
        retryableErrors: ['NETWORK_ERROR', 'TIMEOUT', 'RATE_LIMITED'],
      };

      expect(policy.maxRetries).toBe(3);
      expect(policy.backoffMultiplier).toBe(2);
      expect(policy.retryableErrors).toContain('RATE_LIMITED');
    });
  });
});

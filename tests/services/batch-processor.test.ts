/**
 * Unit tests for BatchProcessor
 */

import { BatchProcessor } from '../../src/services/batch-processor';
import { WorkerConfig, S3ObjectInfo } from '../../src/types/configuration';
import { GuardDutyFinding } from '../../src/types/guardduty';

describe('BatchProcessor', () => {
  let config: WorkerConfig;
  let processor: BatchProcessor;

  beforeEach(() => {
    config = {
      batchSize: 3,
      maxRetries: 2,
      retryBackoffMs: 100,
      enableNormalization: false,
      azureEndpoint: 'https://test.azure.com',
      dcr: {
        immutableId: 'test-dcr',
        streamName: 'test-stream'
      },
      aws: {
        region: 'us-east-1',
        s3BucketName: 'test-bucket'
      },
      azure: {
        tenantId: 'test-tenant',
        clientId: 'test-client',
        clientSecret: 'test-secret',
        workspaceId: 'test-workspace',
        subscriptionId: 'test-sub',
        resourceGroupName: 'test-rg'
      }
    };
    processor = new BatchProcessor(config);
    processor.setAutoProcess(false); // Disable auto-processing for testing
  });

  afterEach(() => {
    processor.clear();
  });

  describe('Queue Management', () => {
    it('should add S3 objects to queue', () => {
      const s3Objects: S3ObjectInfo[] = [
        {
          bucket: 'test-bucket',
          key: 'test-key-1',
          size: 1000,
          lastModified: new Date(),
          etag: 'etag1'
        },
        {
          bucket: 'test-bucket',
          key: 'test-key-2',
          size: 2000,
          lastModified: new Date(),
          etag: 'etag2'
        }
      ];

      processor.addS3Objects(s3Objects);
      
      const queueStatus = processor.getQueueStatus();
      expect(queueStatus.s3Objects).toBe(2);
      expect(queueStatus.findings).toBe(0);
    });

    it('should add findings to queue', () => {
      const findings: GuardDutyFinding[] = [
        createMockFinding('finding-1'),
        createMockFinding('finding-2')
      ];

      processor.addFindings(findings);
      
      const queueStatus = processor.getQueueStatus();
      expect(queueStatus.findings).toBe(2);
      expect(queueStatus.s3Objects).toBe(0);
    });

    it('should clear all queues', () => {
      const s3Objects: S3ObjectInfo[] = [createMockS3Object('key1')];
      const findings: GuardDutyFinding[] = [createMockFinding('finding-1')];

      processor.addS3Objects(s3Objects);
      processor.addFindings(findings);
      
      expect(processor.getQueueStatus().s3Objects).toBe(1);
      expect(processor.getQueueStatus().findings).toBe(1);
      
      processor.clear();
      
      expect(processor.getQueueStatus().s3Objects).toBe(0);
      expect(processor.getQueueStatus().findings).toBe(0);
    });
  });

  describe('Batch Creation', () => {
    it('should prioritize findings over S3 objects in batches', async () => {
      const findings: GuardDutyFinding[] = [
        createMockFinding('finding-1'),
        createMockFinding('finding-2')
      ];
      const s3Objects: S3ObjectInfo[] = [
        createMockS3Object('key1'),
        createMockS3Object('key2')
      ];

      // Add both types to queue
      processor.addFindings(findings);
      processor.addS3Objects(s3Objects);

      // Manually trigger processing
      const processingPromise = processor.processBatches();
      
      // Check immediately after triggering
      await new Promise(resolve => setTimeout(resolve, 10));

      const activeBatches = processor.getActiveBatches();
      expect(activeBatches.length).toBeGreaterThan(0);
      
      // First batch should contain findings first
      const firstBatch = activeBatches[0];
      expect(firstBatch.findings.length).toBe(2);
      expect(firstBatch.s3Objects.length).toBe(1); // Remaining capacity filled with S3 objects
      
      await processingPromise; // Wait for completion
    });

    it('should respect batch size configuration', async () => {
      const findings: GuardDutyFinding[] = [
        createMockFinding('finding-1'),
        createMockFinding('finding-2'),
        createMockFinding('finding-3'),
        createMockFinding('finding-4'),
        createMockFinding('finding-5')
      ];

      processor.addFindings(findings);
      
      // Manually trigger processing
      const processingPromise = processor.processBatches();
      
      // Check immediately after triggering
      await new Promise(resolve => setTimeout(resolve, 10));

      const activeBatches = processor.getActiveBatches();
      expect(activeBatches.length).toBeGreaterThan(0);
      
      // Each batch should not exceed batch size
      activeBatches.forEach(batch => {
        const totalItems = batch.findings.length + batch.s3Objects.length;
        expect(totalItems).toBeLessThanOrEqual(config.batchSize);
      });
      
      await processingPromise; // Wait for completion
    });
  });

  describe('Metrics', () => {
    it('should initialize with default metrics', () => {
      const metrics = processor.getMetrics();
      
      expect(metrics.totalProcessed).toBe(0);
      expect(metrics.totalErrors).toBe(0);
      expect(metrics.successRate).toBe(1.0);
      expect(metrics.queueSize).toBe(0);
      expect(metrics.throughput).toBe(0);
    });

    it('should update queue size in metrics', () => {
      const findings: GuardDutyFinding[] = [createMockFinding('finding-1')];
      const s3Objects: S3ObjectInfo[] = [createMockS3Object('key1')];

      processor.addFindings(findings);
      processor.addS3Objects(s3Objects);
      
      const metrics = processor.getMetrics();
      expect(metrics.queueSize).toBe(2);
    });
  });

  describe('Events', () => {
    it('should emit batch-created event', (done) => {
      processor.on('batch-created', (batch) => {
        expect(batch.batchId).toBeDefined();
        expect(batch.status).toBe('pending');
        done();
      });

      const findings: GuardDutyFinding[] = [createMockFinding('finding-1')];
      processor.addFindings(findings);
      processor.processBatches(); // Manually trigger processing
    });

    it('should emit metrics-updated event', (done) => {
      processor.on('metrics-updated', (metrics) => {
        expect(metrics.queueSize).toBeGreaterThan(0);
        done();
      });

      const findings: GuardDutyFinding[] = [createMockFinding('finding-1')];
      processor.addFindings(findings);
    });
  });
});

// Helper functions
function createMockFinding(id: string): GuardDutyFinding {
  return {
    schemaVersion: '2.0',
    accountId: '123456789012',
    region: 'us-east-1',
    partition: 'aws',
    id,
    arn: `arn:aws:guardduty:us-east-1:123456789012:detector/test/finding/${id}`,
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
}

function createMockS3Object(key: string): S3ObjectInfo {
  return {
    bucket: 'test-bucket',
    key,
    size: 1000,
    lastModified: new Date(),
    etag: `etag-${key}`
  };
}
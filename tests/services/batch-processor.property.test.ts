/**
 * Property-based tests for BatchProcessor
 * **Feature: guardduty-sentinel-integration, Property 4: Batch Processing Configuration**
 * **Validates: Requirements 3.1, 3.4**
 */

import fc from 'fast-check';
import { BatchProcessor } from '../../src/services/batch-processor';
import { WorkerConfig, S3ObjectInfo } from '../../src/types/configuration';
import { GuardDutyFinding } from '../../src/types/guardduty';

describe('BatchProcessor Property Tests', () => {
  let baseConfig: WorkerConfig;

  beforeEach(() => {
    baseConfig = {
      batchSize: 100, // Will be overridden by property tests
      maxRetries: 3,
      retryBackoffMs: 1000,
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
  });

  /**
   * Property 4: Batch Processing Configuration
   * For any set of S3 objects processed, the ingestion worker should group findings 
   * into batches that respect the configured batch size limits.
   */
  describe('Property 4: Batch Processing Configuration', () => {
    it('should respect batch size limits for any configuration', async () => {
      await fc.assert(
        fc.asyncProperty(
          // Generate batch size between 1 and 50
          fc.integer({ min: 1, max: 50 }),
          // Generate array of findings (0 to 30 items)
          fc.array(generateGuardDutyFinding(), { minLength: 0, maxLength: 30 }),
          // Generate array of S3 objects (0 to 30 items)
          fc.array(generateS3ObjectInfo(), { minLength: 0, maxLength: 30 }),
          async (batchSize, findings, s3Objects) => {
            // Skip if no items to process
            if (findings.length === 0 && s3Objects.length === 0) {
              return;
            }

            const config = { ...baseConfig, batchSize };
            const processor = new BatchProcessor(config);
            processor.setAutoProcess(false);

            try {
              // Add items to processor
              if (findings.length > 0) {
                processor.addFindings(findings);
              }
              if (s3Objects.length > 0) {
                processor.addS3Objects(s3Objects);
              }

              // Trigger batch processing
              const processingPromise = processor.processBatches();
              
              // Check batches immediately after triggering
              await new Promise(resolve => setTimeout(resolve, 10));
              
              const activeBatches = processor.getActiveBatches();
              
              // Property: Each batch should not exceed the configured batch size
              for (const batch of activeBatches) {
                const totalItems = batch.findings.length + batch.s3Objects.length;
                expect(totalItems).toBeLessThanOrEqual(batchSize);
                expect(totalItems).toBeGreaterThan(0); // Batches should not be empty
              }
              
              // Wait for processing to complete
              await processingPromise;
              
              // Check completed batches as well
              const completedBatches = processor.getCompletedBatches();
              for (const batch of completedBatches) {
                const totalItems = batch.findings.length + batch.s3Objects.length;
                expect(totalItems).toBeLessThanOrEqual(batchSize);
                expect(totalItems).toBeGreaterThan(0);
              }
              
            } finally {
              processor.clear();
            }
          }
        ),
        { numRuns: 10, timeout: 15000 }
      );
    });
    it('should process all items regardless of batch size configuration', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 3 }),
          fc.array(generateGuardDutyFinding(), { minLength: 1, maxLength: 5 }),
          async (batchSize, findings) => {
            const config = { ...baseConfig, batchSize };
            const processor = new BatchProcessor(config);
            processor.setAutoProcess(false);

            const totalInputItems = findings.length;

            try {
              processor.addFindings(findings);

              // Process all batches
              await processor.processBatches();
              
              // Wait briefly for processing to complete
              await new Promise(resolve => setTimeout(resolve, 50));
              
              const completedBatches = processor.getCompletedBatches();
              
              // Property: All input items should be processed across all batches
              let totalProcessedItems = 0;
              for (const batch of completedBatches) {
                totalProcessedItems += batch.findings.length;
              }
              
              expect(totalProcessedItems).toBe(totalInputItems);
              
            } finally {
              processor.clear();
            }
          }
        ),
        { numRuns: 5, timeout: 10000 }
      );
    }, 15000);

    it('should prioritize findings over S3 objects in batch creation', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 2, max: 10 }), // Batch size at least 2 to test prioritization
          fc.array(generateGuardDutyFinding(), { minLength: 1, maxLength: 15 }),
          fc.array(generateS3ObjectInfo(), { minLength: 1, maxLength: 15 }),
          async (batchSize, findings, s3Objects) => {
            const config = { ...baseConfig, batchSize };
            const processor = new BatchProcessor(config);
            processor.setAutoProcess(false);

            try {
              processor.addFindings(findings);
              processor.addS3Objects(s3Objects);

              const processingPromise = processor.processBatches();
              await new Promise(resolve => setTimeout(resolve, 10));
              
              const activeBatches = processor.getActiveBatches();
              
              if (activeBatches.length > 0) {
                const firstBatch = activeBatches[0];
                
                // Property: If there are findings available and batch has capacity,
                // findings should be included before S3 objects
                if (findings.length > 0) {
                  expect(firstBatch.findings.length).toBeGreaterThan(0);
                  
                  // If batch is not full with just findings, S3 objects should fill remaining space
                  const remainingCapacity = batchSize - firstBatch.findings.length;
                  if (remainingCapacity > 0 && s3Objects.length > 0) {
                    expect(firstBatch.s3Objects.length).toBeGreaterThan(0);
                    expect(firstBatch.s3Objects.length).toBeLessThanOrEqual(remainingCapacity);
                  }
                }
              }
              
              await processingPromise;
              
            } finally {
              processor.clear();
            }
          }
        ),
        { numRuns: 10, timeout: 15000 }
      );
    });
  });
});
// Generators for property-based testing

function generateGuardDutyFinding(): fc.Arbitrary<GuardDutyFinding> {
  return fc.record({
    schemaVersion: fc.constant('2.0'),
    accountId: fc.string({ minLength: 12, maxLength: 12 }).map(s => s.padStart(12, '0')),
    region: fc.constantFrom('us-east-1', 'us-west-2', 'eu-west-1', 'ap-southeast-1'),
    partition: fc.constant('aws'),
    id: fc.uuid(),
    arn: fc.string().map(id => `arn:aws:guardduty:us-east-1:123456789012:detector/test/finding/${id}`),
    type: fc.constantFrom(
      'Trojan:EC2/DNSDataExfiltration',
      'Backdoor:EC2/C&CActivity.B!DNS',
      'CryptoCurrency:EC2/BitcoinTool.B!DNS',
      'Malware:EC2/SuspiciousFile',
      'UnauthorizedAccess:EC2/SSHBruteForce'
    ),
    resource: fc.record({
      resourceType: fc.constantFrom('Instance', 'S3Bucket', 'AccessKey'),
      instanceDetails: fc.option(fc.record({
        instanceId: fc.string().map(s => `i-${s.substring(0, 17)}`),
        instanceType: fc.constantFrom('t2.micro', 't3.small', 'm5.large'),
        instanceState: fc.constantFrom('running', 'stopped', 'terminated'),
        availabilityZone: fc.constantFrom('us-east-1a', 'us-east-1b', 'us-east-1c')
      }))
    }),
    service: fc.record({
      serviceName: fc.constant('guardduty'),
      detectorId: fc.uuid(),
      archived: fc.boolean(),
      count: fc.integer({ min: 1, max: 100 }),
      eventFirstSeen: fc.date().map(d => d.toISOString()),
      eventLastSeen: fc.date().map(d => d.toISOString()),
      resourceRole: fc.constantFrom('TARGET', 'ACTOR')
    }),
    severity: fc.float({ min: 0.0, max: Math.fround(8.9) }),
    createdAt: fc.date().map(d => d.toISOString()),
    updatedAt: fc.date().map(d => d.toISOString()),
    title: fc.string({ minLength: 10, maxLength: 100 }),
    description: fc.string({ minLength: 20, maxLength: 200 })
  });
}

function generateS3ObjectInfo(): fc.Arbitrary<S3ObjectInfo> {
  return fc.record({
    bucket: fc.string({ minLength: 3, maxLength: 63 }).map(s => s.toLowerCase().replace(/[^a-z0-9-]/g, 'a')),
    key: fc.string({ minLength: 1, maxLength: 100 }).map(s => `guardduty/${s}.jsonl.gz`),
    size: fc.integer({ min: 100, max: 10000000 }), // 100 bytes to 10MB
    lastModified: fc.date(),
    etag: fc.string({ minLength: 32, maxLength: 32 }).map(s => `"${s}"`),
    kmsKeyId: fc.option(fc.uuid())
  });
}
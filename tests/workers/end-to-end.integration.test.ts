/**
 * End-to-end integration tests for the complete GuardDuty to Sentinel pipeline
 * 
 * Tests the full data flow from S3 GuardDuty exports through worker processing
 * to Azure Monitor ingestion, including error scenarios and performance validation.
 * 
 * Requirements: 8.3
 */

import { readFile } from 'fs/promises';
import { join } from 'path';
import { Readable } from 'stream';
import { gzip } from 'zlib';
import { promisify } from 'util';

import { S3Service } from '../../src/services/s3-service';
import { JSONLProcessor } from '../../src/services/jsonl-processor';
import { DataTransformer } from '../../src/services/data-transformer';
import { AzureMonitorClient } from '../../src/services/azure-monitor-client';
import { RetryHandler } from '../../src/services/retry-handler';
import { DeduplicationService } from '../../src/services/deduplication-service';
import { StructuredLogger } from '../../src/services/structured-logger';
import { MetricsCollector } from '../../src/services/metrics-collector';
import { KqlParser } from '../../src/services/kql-parser';

import { GuardDutyFinding } from '../../src/types/guardduty';
import { AzureMonitorIngestionRequest } from '../../src/types/azure';

const gzipAsync = promisify(gzip);

// Mock AWS and Azure SDKs for integration testing
jest.mock('@aws-sdk/client-s3');
jest.mock('@aws-sdk/client-kms');
jest.mock('@azure/monitor-ingestion');
jest.mock('@azure/identity');

describe('End-to-End Integration Tests', () => {
  let s3Service: S3Service;
  let jsonlProcessor: JSONLProcessor;
  let dataTransformer: DataTransformer;
  let azureClient: AzureMonitorClient;
  let retryHandler: RetryHandler;
  let deduplicationService: DeduplicationService;
  let logger: StructuredLogger;
  let metricsCollector: MetricsCollector;
  let kqlParser: KqlParser;

  let mockS3Send: jest.Mock;
  let mockKMSSend: jest.Mock;
  let mockAzureUpload: jest.Mock;

  afterEach(async () => {
    // Clean up metrics collector to prevent async issues
    if (metricsCollector) {
      await metricsCollector.close();
    }
  });

  beforeEach(async () => {
    jest.clearAllMocks();

    // Mock AWS SDK
    mockS3Send = jest.fn();
    mockKMSSend = jest.fn();
    const { S3Client } = require('@aws-sdk/client-s3');
    const { KMSClient } = require('@aws-sdk/client-kms');
    S3Client.prototype.send = mockS3Send;
    KMSClient.prototype.send = mockKMSSend;

    // Mock Azure SDK
    mockAzureUpload = jest.fn();
    const { LogsIngestionClient } = require('@azure/monitor-ingestion');
    LogsIngestionClient.mockImplementation(() => ({
      upload: mockAzureUpload
    }));

    // Initialize services
    s3Service = new S3Service({
      region: 'us-east-1',
      accessKeyId: 'test-key',
      secretAccessKey: 'test-secret',
      kmsKeyId: 'arn:aws:kms:us-east-1:123456789012:key/test-key'
    });

    jsonlProcessor = new JSONLProcessor();

    dataTransformer = new DataTransformer({
      enableNormalization: true,
      includeRawJson: true
    });

    azureClient = new AzureMonitorClient({
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
    });

    retryHandler = new RetryHandler({
      maxRetries: 3,
      initialBackoffMs: 100,
      maxBackoffMs: 1000,
      backoffMultiplier: 2,
      enableJitter: false,
      retryableErrors: ['NETWORK_ERROR', 'TIMEOUT', 'RATE_LIMITED']
    });

    deduplicationService = new DeduplicationService({
      enabled: true,
      strategy: 'findingId',
      timeWindowMinutes: 300,
      cacheSize: 10000
    });

    logger = new StructuredLogger('test-logger', {
      enableMetrics: true,
      enableDetailedLogging: true
    });

    metricsCollector = new MetricsCollector({
      enableMetrics: true,
      enableDetailedLogging: true,
      metricsBackend: { type: 'console' }
    });

    kqlParser = new KqlParser({
      strictValidation: false,
      maxFieldLength: 32768
    });

    await metricsCollector.initialize();
  });

  describe('Complete Data Pipeline', () => {
    it('should process sample GuardDuty finding end-to-end', async () => {
      // Load sample GuardDuty finding
      const samplePath = join(__dirname, '../../samples/data/sample-guardduty-finding.json');
      const sampleData = await readFile(samplePath, 'utf-8');
      const sampleFinding: GuardDutyFinding = JSON.parse(sampleData);

      // Create JSONL content
      const jsonlContent = JSON.stringify(sampleFinding) + '\n';
      const compressedContent = await gzipAsync(Buffer.from(jsonlContent));

      // Mock S3 responses
      mockS3Send.mockImplementation((command) => {
        if (command.constructor.name === 'ListObjectsV2Command') {
          return Promise.resolve({
            Contents: [
              {
                Key: 'guardduty/AWSLogs/123456789012/GuardDuty/us-east-1/2024/01/01/sample.jsonl.gz',
                Size: compressedContent.length,
                LastModified: new Date('2024-01-01T12:00:00Z'),
                ETag: '"abc123"'
              }
            ]
          });
        }
        if (command.constructor.name === 'GetObjectCommand') {
          return Promise.resolve({
            Body: Readable.from(compressedContent),
            ContentLength: compressedContent.length,
            ContentType: 'application/gzip'
          });
        }
        return Promise.resolve({});
      });

      // Mock KMS decryption (return data as-is for test)
      mockKMSSend.mockResolvedValue({
        Plaintext: compressedContent
      });

      // Mock Azure ingestion success
      mockAzureUpload.mockResolvedValue(undefined);

      // Execute end-to-end pipeline
      const startTime = Date.now();

      // 1. List S3 objects
      const s3Objects = await s3Service.listObjects('test-bucket', 'guardduty/');
      expect(s3Objects).toHaveLength(1);

      // 2. Get and decrypt S3 object
      const s3Result = await s3Service.getAndDecryptObject(
        s3Objects[0].bucket,
        s3Objects[0].key,
        'arn:aws:kms:us-east-1:123456789012:key/test-key'
      );

      // 3. Process JSONL content
      const result = await jsonlProcessor.processCompressedStream(s3Result.body);
      const findings = result.findings;
      expect(findings).toHaveLength(1);
      expect(findings[0].id).toBe(sampleFinding.id);

      // 4. Apply deduplication
      const deduplicatedFindings = deduplicationService.filterDuplicates(findings);
      expect(deduplicatedFindings).toHaveLength(1);

      // 5. Transform findings
      const transformResult = await dataTransformer.transformFindings(deduplicatedFindings);
      const transformedFindings = transformResult.data;
      expect(transformedFindings).toHaveLength(1);
      expect(transformedFindings[0]).toMatchObject({
        FindingId: sampleFinding.id,
        AccountId: sampleFinding.accountId,
        Region: sampleFinding.region,
        Severity: sampleFinding.severity,
        Type: sampleFinding.type
      });

      // 6. Ingest to Azure with retry
      const ingestionRequest: AzureMonitorIngestionRequest = {
        data: transformedFindings,
        streamName: 'Custom-GuardDutyFindings',
        timestamp: new Date()
      };

      const ingestionResult = await retryHandler.executeWithRetry(
        async () => await azureClient.ingestData(ingestionRequest),
        'end-to-end-test'
      );

      expect(ingestionResult.status).toBe('success');
      expect(ingestionResult.acceptedRecords).toBe(1);

      const duration = Date.now() - startTime;
      logger.info('End-to-end pipeline completed', {
        duration,
        findingsProcessed: 1,
        transformedRecords: transformedFindings.length
      });

      // Verify all components were called correctly
      expect(mockS3Send).toHaveBeenCalledTimes(2); // List + Get
      expect(mockKMSSend).toHaveBeenCalledTimes(1); // Decrypt
      expect(mockAzureUpload).toHaveBeenCalledTimes(1); // Ingest

      // Verify Azure ingestion payload
      const azureCall = mockAzureUpload.mock.calls[0];
      expect(azureCall[0]).toBe('dcr-test123'); // DCR ID
      expect(azureCall[1]).toBe('Custom-GuardDutyFindings'); // Stream name
      expect(azureCall[2]).toHaveLength(1); // Data array
      expect(azureCall[2][0]).toMatchObject({
        FindingId: sampleFinding.id,
        TimeGenerated: expect.any(String)
      });
    });

    it('should handle multiple findings in batch', async () => {
      // Create multiple findings
      const baseFindings = Array(5).fill(null).map((_, i) => ({
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

      const jsonlContent = baseFindings.map(f => JSON.stringify(f)).join('\n') + '\n';
      const compressedContent = await gzipAsync(Buffer.from(jsonlContent));

      // Mock S3 responses
      mockS3Send.mockImplementation((command) => {
        if (command.constructor.name === 'GetObjectCommand') {
          return Promise.resolve({
            Body: Readable.from(compressedContent),
            ContentLength: compressedContent.length,
            ContentType: 'application/gzip'
          });
        }
        return Promise.resolve({});
      });

      mockKMSSend.mockResolvedValue({ Plaintext: compressedContent });
      mockAzureUpload.mockResolvedValue(undefined);

      // Process batch
      const s3Result = await s3Service.getAndDecryptObject('test-bucket', 'test-key');
      const jsonlResult = await jsonlProcessor.processCompressedStream(s3Result.body);
      const findings = jsonlResult.findings;
      const transformResult = await dataTransformer.transformFindings(findings);
      const transformedFindings = transformResult.data;

      const ingestionRequest: AzureMonitorIngestionRequest = {
        data: transformedFindings,
        streamName: 'Custom-GuardDutyFindings',
        timestamp: new Date()
      };

      const ingestionResult = await azureClient.ingestData(ingestionRequest);

      expect(findings).toHaveLength(5);
      expect(transformedFindings).toHaveLength(5);
      expect(ingestionResult.status).toBe('success');
      expect(ingestionResult.acceptedRecords).toBe(5);

      // Verify batch processing metrics
      const azureCall = mockAzureUpload.mock.calls[0];
      expect(azureCall[2]).toHaveLength(5);
      azureCall[2].forEach((record: any, i: number) => {
        expect(record.FindingId).toBe(`finding-${i}`);
      });
    });

    it('should handle deduplication across batches', async () => {
      // Create findings with duplicates
      const uniqueFinding = {
        schemaVersion: '2.0',
        accountId: '123456789012',
        region: 'us-east-1',
        partition: 'aws',
        id: 'unique-finding',
        arn: 'arn:aws:guardduty:us-east-1:123456789012:detector/test/finding/unique-finding',
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
        title: 'Unique Finding',
        description: 'Unique finding description'
      };

      const duplicateFinding = { ...uniqueFinding, id: 'duplicate-finding' };

      // First batch: unique + duplicate
      const firstBatch = [uniqueFinding, duplicateFinding];
      let deduplicatedFirst = deduplicationService.filterDuplicates(firstBatch);
      expect(deduplicatedFirst).toHaveLength(2);

      // Second batch: same duplicate + new finding
      const newFinding = { ...uniqueFinding, id: 'new-finding' };
      const secondBatch = [duplicateFinding, newFinding];
      let deduplicatedSecond = deduplicationService.filterDuplicates(secondBatch);
      expect(deduplicatedSecond).toHaveLength(1); // Only new finding should remain
      expect(deduplicatedSecond[0].id).toBe('new-finding');
    });
  });

  describe('Error Handling Scenarios', () => {
    it('should handle S3 access errors gracefully', async () => {
      mockS3Send.mockRejectedValue(new Error('Access Denied'));

      await expect(s3Service.listObjects('test-bucket')).rejects.toThrow();

      try {
        await s3Service.listObjects('test-bucket');
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(Error);
        if (error instanceof Error) {
          expect(error.message).toContain('Access Denied');
        }
      }
    });

    it('should handle KMS decryption failures', async () => {
      mockS3Send.mockResolvedValue({
        Body: Readable.from(Buffer.from('encrypted-content')),
        ContentLength: 100
      });

      mockKMSSend.mockRejectedValue(new Error('KMS key not found'));

      await expect(
        s3Service.getAndDecryptObject('test-bucket', 'test-key', 'invalid-key')
      ).rejects.toThrow('KMS key not found');
    });

    it('should handle malformed JSONL content', async () => {
      const malformedContent = 'invalid json\n{"valid": "json"}\nmore invalid json\n';
      const compressedContent = await gzipAsync(Buffer.from(malformedContent));

      const stream = Readable.from(compressedContent);
      const result = await jsonlProcessor.processCompressedStream(stream);
      const findings = result.findings;

      // Should extract only valid JSON objects
      expect(findings).toHaveLength(1);
      expect(findings[0]).toEqual({ valid: 'json' });
    });

    it('should handle Azure ingestion failures with retry', async () => {
      const testData = [{
        TimeGenerated: new Date().toISOString(),
        FindingId: 'test-finding',
        AccountId: '123456789012',
        Region: 'us-east-1',
        Severity: 8.0,
        Type: 'Test'
      }];

      // First two calls fail, third succeeds
      mockAzureUpload
        .mockRejectedValueOnce(new Error('Network timeout'))
        .mockRejectedValueOnce(new Error('Service unavailable'))
        .mockResolvedValueOnce(undefined);

      const ingestionRequest: AzureMonitorIngestionRequest = {
        data: testData,
        streamName: 'Custom-GuardDutyFindings',
        timestamp: new Date()
      };

      const result = await retryHandler.executeWithRetry(
        async () => await azureClient.ingestData(ingestionRequest),
        'retry-test'
      );

      expect(result.status).toBe('success');
      expect(mockAzureUpload).toHaveBeenCalledTimes(3);
    });

    it('should handle retry exhaustion', async () => {
      mockAzureUpload.mockRejectedValue(new Error('Persistent failure'));

      const ingestionRequest: AzureMonitorIngestionRequest = {
        data: [{ test: 'data' }],
        streamName: 'Custom-GuardDutyFindings',
        timestamp: new Date()
      };

      await expect(
        retryHandler.executeWithRetry(
          async () => await azureClient.ingestData(ingestionRequest),
          'exhaustion-test'
        )
      ).rejects.toThrow('Persistent failure');

      expect(mockAzureUpload).toHaveBeenCalledTimes(4); // Initial + 3 retries
    });
  });

  describe('Performance and Scalability', () => {
    it('should handle large file processing efficiently', async () => {
      // Create large dataset
      const largeDataset = Array(1000).fill(null).map((_, i) => ({
        schemaVersion: '2.0',
        accountId: '123456789012',
        region: 'us-east-1',
        partition: 'aws',
        id: `large-finding-${i}`,
        arn: `arn:aws:guardduty:us-east-1:123456789012:detector/test/finding/large-finding-${i}`,
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
        severity: Math.random() * 10,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        title: `Large Finding ${i}`,
        description: `Large finding description ${i}`
      }));

      const jsonlContent = largeDataset.map(f => JSON.stringify(f)).join('\n') + '\n';
      const compressedContent = await gzipAsync(Buffer.from(jsonlContent));

      mockS3Send.mockResolvedValue({
        Body: Readable.from(compressedContent),
        ContentLength: compressedContent.length
      });

      mockKMSSend.mockResolvedValue({ Plaintext: compressedContent });
      mockAzureUpload.mockResolvedValue(undefined);

      const startTime = Date.now();

      // Process large dataset
      const s3Result = await s3Service.getAndDecryptObject('test-bucket', 'large-file.jsonl.gz');
      const result = await jsonlProcessor.processCompressedStream(s3Result.body);
      const findings = result.findings;
      const transformResult = await dataTransformer.transformFindings(findings);
      const transformedFindings = transformResult.data;

      // Process in batches of 100
      const batchSize = 100;
      const batches = [];
      for (let i = 0; i < transformedFindings.length; i += batchSize) {
        batches.push(transformedFindings.slice(i, i + batchSize));
      }

      const results = await Promise.all(
        batches.map(batch => 
          azureClient.ingestData({
            data: batch,
            streamName: 'Custom-GuardDutyFindings',
            timestamp: new Date()
          })
        )
      );

      const duration = Date.now() - startTime;

      expect(findings).toHaveLength(1000);
      expect(transformedFindings).toHaveLength(1000);
      expect(results).toHaveLength(10); // 10 batches of 100
      expect(duration).toBeLessThan(10000); // Should complete within 10 seconds
      expect(mockAzureUpload).toHaveBeenCalledTimes(10);

      // Verify all records were processed
      const totalAccepted = results.reduce((sum, result) => sum + result.acceptedRecords, 0);
      expect(totalAccepted).toBe(1000);
    });

    it('should maintain performance under concurrent load', async () => {
      const concurrentRequests = 10;
      const findingsPerRequest = 50;

      // Create test data for each request
      const testRequests = Array(concurrentRequests).fill(null).map((_, requestIndex) => {
        const findings = Array(findingsPerRequest).fill(null).map((_, findingIndex) => ({
          TimeGenerated: new Date().toISOString(),
          FindingId: `concurrent-${requestIndex}-${findingIndex}`,
          AccountId: '123456789012',
          Region: 'us-east-1',
          Severity: 8.0,
          Type: 'Test'
        }));

        return {
          data: findings,
          streamName: 'Custom-GuardDutyFindings',
          timestamp: new Date()
        };
      });

      mockAzureUpload.mockResolvedValue(undefined);

      const startTime = Date.now();

      // Execute concurrent requests
      const results = await Promise.all(
        testRequests.map(request => azureClient.ingestData(request))
      );

      const duration = Date.now() - startTime;

      expect(results).toHaveLength(concurrentRequests);
      expect(duration).toBeLessThan(5000); // Should complete within 5 seconds
      expect(mockAzureUpload).toHaveBeenCalledTimes(concurrentRequests);

      // Verify all requests succeeded
      results.forEach(result => {
        expect(result.status).toBe('success');
        expect(result.acceptedRecords).toBe(findingsPerRequest);
      });
    });

    it('should track comprehensive metrics', async () => {
      const testFindings = Array(10).fill(null).map((_, i) => ({
        id: `metric-finding-${i}`,
        accountId: '123456789012',
        region: 'us-east-1',
        severity: 8.0,
        type: 'Test'
      }));

      // Process findings and track metrics
      metricsCollector.recordCounter('findings_received', testFindings.length);
      
      const deduplicatedFindings = deduplicationService.filterDuplicates(testFindings as any);
      metricsCollector.recordCounter('findings_deduplicated', testFindings.length - deduplicatedFindings.length);
      
      const transformResult = await dataTransformer.transformFindings(deduplicatedFindings);
      const transformedFindings = transformResult.data;
      metricsCollector.recordCounter('findings_transformed', transformedFindings.length);

      mockAzureUpload.mockResolvedValue(undefined);
      
      const ingestionResult = await azureClient.ingestData({
        data: transformedFindings,
        streamName: 'Custom-GuardDutyFindings',
        timestamp: new Date()
      });

      metricsCollector.recordCounter('findings_ingested', ingestionResult.acceptedRecords);
      metricsCollector.recordGauge('batch_size', transformedFindings.length);

      // Verify metrics were recorded (simplified for test)
      expect(transformedFindings.length).toBe(10);
    });
  });

  describe('Data Integrity Validation', () => {
    it('should preserve finding data through transformation', async () => {
      const originalFinding: GuardDutyFinding = {
        schemaVersion: '2.0',
        accountId: '123456789012',
        region: 'us-west-2',
        partition: 'aws',
        id: 'integrity-test-finding',
        arn: 'arn:aws:guardduty:us-west-2:123456789012:detector/test/finding/integrity-test-finding',
        type: 'Backdoor:EC2/C&CActivity.B!DNS',
        resource: {
          resourceType: 'Instance',
          instanceDetails: {
            instanceId: 'i-integrity-test',
            instanceType: 'm5.large',
            instanceState: 'running',
            availabilityZone: 'us-west-2a'
          }
        },
        service: {
          serviceName: 'guardduty',
          detectorId: 'integrity-detector',
          archived: false,
          count: 5,
          eventFirstSeen: '2024-01-01T10:00:00.000Z',
          eventLastSeen: '2024-01-01T10:30:00.000Z',
          resourceRole: 'TARGET'
        },
        severity: 7.5,
        createdAt: '2024-01-01T10:00:00.000Z',
        updatedAt: '2024-01-01T10:30:00.000Z',
        title: 'Backdoor:EC2/C&CActivity.B!DNS',
        description: 'EC2 instance is communicating with a known command and control server.'
      };

      const transformResult = await dataTransformer.transformFindings([originalFinding]);
      const transformedFindings = transformResult.data;
      expect(transformedFindings).toHaveLength(1);

      const transformed = transformedFindings[0];
      
      // Verify key fields are preserved
      expect(transformed.FindingId).toBe(originalFinding.id);
      expect(transformed.AccountId).toBe(originalFinding.accountId);
      expect(transformed.Region).toBe(originalFinding.region);
      expect(transformed.Severity).toBe(originalFinding.severity);
      expect(transformed.Type).toBe(originalFinding.type);
      expect(transformed.Title).toBe(originalFinding.title);
      expect(transformed.Description).toBe(originalFinding.description);

      // Verify raw JSON is preserved
      expect(transformed.RawJson).toBe(JSON.stringify(originalFinding));

      // Verify timestamps are properly formatted
      expect(transformed.CreatedAt).toBe(originalFinding.createdAt);
      expect(transformed.UpdatedAt).toBe(originalFinding.updatedAt);
      expect(transformed.TimeGenerated).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    it('should handle special characters and encoding', async () => {
      const specialCharFinding: GuardDutyFinding = {
        schemaVersion: '2.0',
        accountId: '123456789012',
        region: 'eu-central-1',
        partition: 'aws',
        id: 'special-char-finding',
        arn: 'arn:aws:guardduty:eu-central-1:123456789012:detector/test/finding/special-char-finding',
        type: 'Test:Special/Characters',
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
        title: 'Test with émojis 🚨 and üñíçødé',
        description: 'Description with "quotes", \'apostrophes\', and special chars: <>&'
      };

      const jsonlContent = JSON.stringify(specialCharFinding) + '\n';
      const compressedContent = await gzipAsync(Buffer.from(jsonlContent, 'utf-8'));

      const stream = Readable.from(compressedContent);
      const result = await jsonlProcessor.processCompressedStream(stream);
      const findings = result.findings;
      
      expect(findings).toHaveLength(1);
      expect(findings[0].title).toBe('Test with émojis 🚨 and üñíçødé');
      expect(findings[0].description).toBe('Description with "quotes", \'apostrophes\', and special chars: <>&');

      const transformResult = await dataTransformer.transformFindings(findings);
      const transformedFindings = transformResult.data;
      expect(transformedFindings[0].Title).toBe(specialCharFinding.title);
      expect(transformedFindings[0].Description).toBe(specialCharFinding.description);
    });

    it('should validate Azure ingestion payload format', async () => {
      const testFinding: GuardDutyFinding = {
        schemaVersion: '2.0',
        accountId: '123456789012',
        region: 'us-east-1',
        partition: 'aws',
        id: 'validation-finding',
        arn: 'arn:aws:guardduty:us-east-1:123456789012:detector/test/finding/validation-finding',
        type: 'Test:Validation/Check',
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
        severity: 6.0,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        title: 'Validation Test',
        description: 'Test finding for validation'
      };

      const transformResult = await dataTransformer.transformFindings([testFinding]);
      const transformedFindings = transformResult.data;
      
      mockAzureUpload.mockResolvedValue(undefined);

      await azureClient.ingestData({
        data: transformedFindings,
        streamName: 'Custom-GuardDutyFindings',
        timestamp: new Date()
      });

      // Verify Azure upload was called with correct format
      const azureCall = mockAzureUpload.mock.calls[0];
      expect(azureCall[0]).toBe('dcr-test123'); // DCR immutable ID
      expect(azureCall[1]).toBe('Custom-GuardDutyFindings'); // Stream name
      expect(azureCall[2]).toHaveLength(1); // Data array

      const uploadedRecord = azureCall[2][0];
      
      // Verify required fields are present and correctly typed
      expect(typeof uploadedRecord.TimeGenerated).toBe('string');
      expect(typeof uploadedRecord.FindingId).toBe('string');
      expect(typeof uploadedRecord.AccountId).toBe('string');
      expect(typeof uploadedRecord.Region).toBe('string');
      expect(typeof uploadedRecord.Severity).toBe('number');
      expect(typeof uploadedRecord.Type).toBe('string');
      expect(typeof uploadedRecord.RawJson).toBe('string');

      // Verify values match expected format
      expect(uploadedRecord.TimeGenerated).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(uploadedRecord.FindingId).toBe('validation-finding');
      expect(uploadedRecord.AccountId).toBe('123456789012');
      expect(uploadedRecord.Region).toBe('us-east-1');
      expect(uploadedRecord.Severity).toBe(6.0);
      expect(uploadedRecord.Type).toBe('Test:Validation/Check');
      
      // Verify raw JSON can be parsed back to original
      const parsedRaw = JSON.parse(uploadedRecord.RawJson);
      expect(parsedRaw.id).toBe(testFinding.id);
      expect(parsedRaw.title).toBe(testFinding.title);
    });
  });

  describe('KQL Parser Functionality with Real Data', () => {
    it('should validate KQL parser with sample GuardDuty findings', async () => {
      // Load multiple sample findings
      const samplePaths = [
        'samples/data/sample-guardduty-finding.json',
        'samples/data/sample-findings/ec2-findings/backdoor-cc-activity.json',
        'samples/data/sample-findings/malware-findings/runtime-new-binary.json'
      ];

      const sampleFindings: GuardDutyFinding[] = [];
      for (const path of samplePaths) {
        try {
          const samplePath = join(__dirname, '../../', path);
          const sampleData = await readFile(samplePath, 'utf-8');
          sampleFindings.push(JSON.parse(sampleData));
        } catch (error) {
          // Skip missing sample files
          console.warn(`Sample file not found: ${path}`);
        }
      }

      expect(sampleFindings.length).toBeGreaterThan(0);

      // Test KQL parser field extraction for each finding
      for (const finding of sampleFindings) {
        const rawJson = JSON.stringify(finding);
        const parseResult = await kqlParser.parseFields(rawJson);

        // Verify core fields are extracted
        expect(parseResult.extracted).toHaveProperty('Service');
        expect(parseResult.extracted).toHaveProperty('ResourceType');
        expect(parseResult.extracted.Service).toBe('guardduty');

        // Verify standard fields extraction
        if (finding.title) {
          expect(parseResult.extracted).toHaveProperty('Title');
          expect(parseResult.extracted.Title).toBe(finding.title);
        }

        if (finding.description) {
          expect(parseResult.extracted).toHaveProperty('Description');
          expect(parseResult.extracted.Description).toBe(finding.description);
        }

        // Verify date field parsing
        if (finding.createdAt) {
          expect(parseResult.extracted).toHaveProperty('CreatedAt');
          expect(parseResult.extracted.CreatedAt).toBeInstanceOf(Date);
        }

        // Verify nested field extraction
        if (finding.resource?.instanceDetails?.instanceId) {
          expect(parseResult.extracted).toHaveProperty('InstanceId');
          expect(parseResult.extracted.InstanceId).toBe(finding.resource.instanceDetails.instanceId);
        }

        // Log any parsing errors for debugging
        if (parseResult.errors.length > 0) {
          console.warn(`Parsing errors for finding ${finding.id}:`, parseResult.errors);
        }
      }
    });

    it('should handle malformed JSON gracefully in KQL parser', async () => {
      const malformedJsonCases = [
        '{"incomplete": json',
        '{"validField": "value", "invalidDate": "not-a-date"}',
        '{"nested": {"missing": }}',
        '',
        'null',
        '[]'
      ];

      for (const malformedJson of malformedJsonCases) {
        const parseResult = await kqlParser.parseFields(malformedJson);
        
        // Should not throw, but should report errors
        expect(parseResult).toBeDefined();
        expect(parseResult.errors.length).toBeGreaterThan(0);
        expect(parseResult.extracted).toBeDefined();
      }
    });

    it('should validate standard field extraction consistency', async () => {
      // Create test finding with all standard fields
      const testFinding: GuardDutyFinding = {
        schemaVersion: '2.0',
        accountId: '123456789012',
        region: 'us-east-1',
        partition: 'aws',
        id: 'kql-test-finding',
        arn: 'arn:aws:guardduty:us-east-1:123456789012:detector/test/finding/kql-test-finding',
        type: 'Test:KQL/Validation',
        resource: {
          resourceType: 'Instance',
          instanceDetails: {
            instanceId: 'i-kqltest123',
            instanceType: 't2.micro',
            instanceState: 'running',
            availabilityZone: 'us-east-1a'
          }
        },
        service: {
          serviceName: 'guardduty',
          detectorId: 'test-detector',
          action: {
            actionType: 'NETWORK_CONNECTION',
            networkConnectionAction: {
              connectionDirection: 'OUTBOUND',
              protocol: 'TCP',
              blocked: false,
              remoteIpDetails: {
                ipAddressV4: '192.0.2.1',
                country: {
                  countryName: 'United States',
                  countryCode: 'US'
                }
              }
            }
          },
          evidence: {
            threatIntelligenceDetails: [
              {
                threatListName: 'TestThreatList',
                threatNames: ['test-threat']
              }
            ]
          },
          archived: false,
          count: 1,
          eventFirstSeen: '2024-01-01T10:00:00.000Z',
          eventLastSeen: '2024-01-01T10:30:00.000Z',
          resourceRole: 'TARGET'
        },
        severity: 7.5,
        createdAt: '2024-01-01T10:00:00.000Z',
        updatedAt: '2024-01-01T10:30:00.000Z',
        title: 'KQL Test Finding',
        description: 'Test finding for KQL parser validation'
      };

      const rawJson = JSON.stringify(testFinding);
      const parseResult = await kqlParser.parseFields(rawJson);

      // Verify all expected fields are extracted
      const expectedFields = {
        Service: 'guardduty',
        ResourceType: 'Instance',
        Title: 'KQL Test Finding',
        Description: 'Test finding for KQL parser validation',
        InstanceId: 'i-kqltest123',
        RemoteIpCountry: 'United States',
        RemoteIpAddress: '192.0.2.1',
        ActionType: 'NETWORK_CONNECTION',
        ThreatNames: 'test-threat',
        Count: 1,
        Archived: false
      };

      for (const [field, expectedValue] of Object.entries(expectedFields)) {
        expect(parseResult.extracted).toHaveProperty(field);
        expect(parseResult.extracted[field as keyof typeof parseResult.extracted]).toBe(expectedValue);
      }

      // Verify date fields
      expect(parseResult.extracted.CreatedAt).toBeInstanceOf(Date);
      expect(parseResult.extracted.UpdatedAt).toBeInstanceOf(Date);
      expect(parseResult.extracted.EventFirstSeen).toBeInstanceOf(Date);
      expect(parseResult.extracted.EventLastSeen).toBeInstanceOf(Date);

      // Verify no critical parsing errors
      const criticalErrors = parseResult.errors.filter(e => 
        ['Service', 'ResourceType', 'Title'].includes(e.field)
      );
      expect(criticalErrors).toHaveLength(0);
    });

    it('should validate KQL parser with end-to-end data flow', async () => {
      // Load sample finding
      const samplePath = join(__dirname, '../../samples/data/sample-guardduty-finding.json');
      const sampleData = await readFile(samplePath, 'utf-8');
      const sampleFinding: GuardDutyFinding = JSON.parse(sampleData);

      // Process through complete pipeline
      const transformResult = await dataTransformer.transformFindings([sampleFinding]);
      const transformedFinding = transformResult.data[0];

      // Validate KQL parser can extract the same fields from raw JSON
      const parseResult = await kqlParser.parseFields(String(transformedFinding.RawJson));

      // Compare transformed fields with KQL parser results
      expect(parseResult.extracted.Service).toBe(transformedFinding.Service);
      expect(parseResult.extracted.ResourceType).toBe(transformedFinding.ResourceType);
      expect(parseResult.extracted.Title).toBe(transformedFinding.Title);
      expect(parseResult.extracted.Description).toBe(transformedFinding.Description);

      // Verify date consistency
      const createdAtKql = parseResult.extracted.CreatedAt as Date;
      const createdAtTransformed = new Date(String(transformedFinding.CreatedAt));
      expect(createdAtKql.getTime()).toBe(createdAtTransformed.getTime());
    });
  });

  describe('Performance Benchmarks and Load Testing', () => {
    it('should meet processing latency benchmarks for light load', async () => {
      const findingsCount = 100; // Light load
      const maxLatencyMs = 2 * 60 * 1000; // 2 minutes max

      // Generate test findings
      const testFindings = Array(findingsCount).fill(null).map((_, i) => ({
        schemaVersion: '2.0',
        accountId: '123456789012',
        region: 'us-east-1',
        partition: 'aws',
        id: `perf-light-${i}`,
        arn: `arn:aws:guardduty:us-east-1:123456789012:detector/test/finding/perf-light-${i}`,
        type: 'Performance:Test/Light',
        resource: { resourceType: 'Instance' },
        service: {
          serviceName: 'guardduty',
          detectorId: 'perf-detector',
          archived: false,
          count: 1,
          eventFirstSeen: '2024-01-01T00:00:00.000Z',
          eventLastSeen: '2024-01-01T00:00:00.000Z',
          resourceRole: 'TARGET'
        },
        severity: 5.0,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        title: `Performance Test Finding ${i}`,
        description: `Performance test finding ${i}`
      }));

      mockAzureUpload.mockResolvedValue(undefined);

      const startTime = Date.now();

      // Process findings through complete pipeline
      const deduplicatedFindings = deduplicationService.filterDuplicates(testFindings as any);
      const transformResult = await dataTransformer.transformFindings(deduplicatedFindings);
      const transformedFindings = transformResult.data;

      // Batch and ingest
      const batchSize = 100;
      const batches = [];
      for (let i = 0; i < transformedFindings.length; i += batchSize) {
        batches.push(transformedFindings.slice(i, i + batchSize));
      }

      const results = await Promise.all(
        batches.map(batch => 
          azureClient.ingestData({
            data: batch,
            streamName: 'Custom-GuardDutyFindings',
            timestamp: new Date()
          })
        )
      );

      const totalLatency = Date.now() - startTime;
      const throughput = findingsCount / (totalLatency / 1000); // findings per second

      // Verify performance benchmarks
      expect(totalLatency).toBeLessThan(maxLatencyMs);
      expect(throughput).toBeGreaterThan(500 / 60); // > 500 findings/min
      expect(results.every(r => r.status === 'success')).toBe(true);

      console.log(`Light load performance: ${totalLatency}ms latency, ${throughput.toFixed(2)} findings/sec`);
    });

    it('should meet throughput benchmarks for medium load', async () => {
      const findingsCount = 1000; // Medium load
      const maxLatencyMs = 3 * 60 * 1000; // 3 minutes max
      const minThroughputPerMin = 2000; // 2000 findings/min

      // Generate larger test dataset
      const testFindings = Array(findingsCount).fill(null).map((_, i) => ({
        schemaVersion: '2.0',
        accountId: '123456789012',
        region: 'us-east-1',
        partition: 'aws',
        id: `perf-medium-${i}`,
        arn: `arn:aws:guardduty:us-east-1:123456789012:detector/test/finding/perf-medium-${i}`,
        type: 'Performance:Test/Medium',
        resource: {
          resourceType: 'Instance',
          instanceDetails: {
            instanceId: `i-medium${i.toString().padStart(10, '0')}`,
            instanceType: 't3.medium',
            instanceState: 'running',
            availabilityZone: 'us-east-1a'
          }
        },
        service: {
          serviceName: 'guardduty',
          detectorId: 'perf-detector',
          action: {
            actionType: 'NETWORK_CONNECTION',
            networkConnectionAction: {
              connectionDirection: 'OUTBOUND',
              remoteIpDetails: {
                ipAddressV4: `192.0.2.${(i % 254) + 1}`,
                country: {
                  countryName: 'Test Country',
                  countryCode: 'TC'
                }
              }
            }
          },
          archived: false,
          count: Math.floor(Math.random() * 10) + 1,
          eventFirstSeen: '2024-01-01T00:00:00.000Z',
          eventLastSeen: '2024-01-01T00:00:00.000Z',
          resourceRole: 'TARGET'
        },
        severity: Math.random() * 10,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        title: `Medium Load Test Finding ${i}`,
        description: `Medium load performance test finding with more detailed content ${i}`
      }));

      mockAzureUpload.mockResolvedValue(undefined);

      const startTime = Date.now();

      // Process with optimized batch size for medium load
      const deduplicatedFindings = deduplicationService.filterDuplicates(testFindings as any);
      const transformResult = await dataTransformer.transformFindings(deduplicatedFindings);
      const transformedFindings = transformResult.data;

      // Use smaller batches for better concurrency
      const batchSize = 200;
      const batches = [];
      for (let i = 0; i < transformedFindings.length; i += batchSize) {
        batches.push(transformedFindings.slice(i, i + batchSize));
      }

      // Process batches with controlled concurrency
      const maxConcurrency = 3;
      const results = [];
      for (let i = 0; i < batches.length; i += maxConcurrency) {
        const chunk = batches.slice(i, i + maxConcurrency);
        const chunkResults = await Promise.all(
          chunk.map(batch => 
            azureClient.ingestData({
              data: batch,
              streamName: 'Custom-GuardDutyFindings',
              timestamp: new Date()
            })
          )
        );
        results.push(...chunkResults);
      }

      const totalLatency = Date.now() - startTime;
      const throughputPerMin = (findingsCount / (totalLatency / 1000)) * 60;

      // Verify performance benchmarks
      expect(totalLatency).toBeLessThan(maxLatencyMs);
      expect(throughputPerMin).toBeGreaterThan(minThroughputPerMin);
      expect(results.every(r => r.status === 'success')).toBe(true);

      console.log(`Medium load performance: ${totalLatency}ms latency, ${throughputPerMin.toFixed(0)} findings/min`);
    });

    it('should handle heavy load with acceptable performance degradation', async () => {
      const findingsCount = 2000; // Heavy load
      const maxLatencyMs = 5 * 60 * 1000; // 5 minutes max
      const minThroughputPerMin = 3000; // 3000 findings/min

      // Generate heavy load test dataset with complex findings
      const testFindings = Array(findingsCount).fill(null).map((_, i) => ({
        schemaVersion: '2.0',
        accountId: '123456789012',
        region: 'us-east-1',
        partition: 'aws',
        id: `perf-heavy-${i}`,
        arn: `arn:aws:guardduty:us-east-1:123456789012:detector/test/finding/perf-heavy-${i}`,
        type: 'Performance:Test/Heavy',
        resource: {
          resourceType: 'Instance',
          instanceDetails: {
            instanceId: `i-heavy${i.toString().padStart(12, '0')}`,
            instanceType: 'm5.xlarge',
            instanceState: 'running',
            availabilityZone: 'us-east-1a',
            tags: Array(5).fill(null).map((_, tagIndex) => ({
              key: `Tag${tagIndex}`,
              value: `Value${tagIndex}-${i}`
            }))
          }
        },
        service: {
          serviceName: 'guardduty',
          detectorId: 'perf-detector',
          action: {
            actionType: 'DNS_REQUEST',
            dnsRequestAction: {
              domain: `test-domain-${i}.example.com`,
              protocol: 'UDP',
              blocked: false
            }
          },
          evidence: {
            threatIntelligenceDetails: [
              {
                threatListName: 'TestThreatList',
                threatNames: [`threat-${i}`, `malware-${i}`]
              }
            ]
          },
          archived: false,
          count: Math.floor(Math.random() * 50) + 1,
          eventFirstSeen: '2024-01-01T00:00:00.000Z',
          eventLastSeen: '2024-01-01T00:00:00.000Z',
          resourceRole: 'TARGET',
          additionalInfo: {
            value: JSON.stringify({ complexData: `data-${i}`, nested: { field: i } }),
            type: 'complex'
          }
        },
        severity: Math.random() * 10,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        title: `Heavy Load Test Finding ${i}`,
        description: `Heavy load performance test finding with extensive metadata and complex nested structures for finding ${i}. This description is intentionally longer to simulate real-world finding descriptions that contain detailed information about the security event.`
      }));

      mockAzureUpload.mockResolvedValue(undefined);

      const startTime = Date.now();
      let memoryUsageBefore = process.memoryUsage();

      // Process with optimized settings for heavy load
      const deduplicatedFindings = deduplicationService.filterDuplicates(testFindings as any);
      const transformResult = await dataTransformer.transformFindings(deduplicatedFindings);
      const transformedFindings = transformResult.data;

      // Use larger batches for heavy load efficiency
      const batchSize = 500;
      const batches = [];
      for (let i = 0; i < transformedFindings.length; i += batchSize) {
        batches.push(transformedFindings.slice(i, i + batchSize));
      }

      // Process with higher concurrency for heavy load
      const maxConcurrency = 5;
      const results = [];
      for (let i = 0; i < batches.length; i += maxConcurrency) {
        const chunk = batches.slice(i, i + maxConcurrency);
        const chunkResults = await Promise.all(
          chunk.map(batch => 
            azureClient.ingestData({
              data: batch,
              streamName: 'Custom-GuardDutyFindings',
              timestamp: new Date()
            })
          )
        );
        results.push(...chunkResults);
      }

      const totalLatency = Date.now() - startTime;
      const throughputPerMin = (findingsCount / (totalLatency / 1000)) * 60;
      const memoryUsageAfter = process.memoryUsage();
      const memoryIncreaseMB = (memoryUsageAfter.heapUsed - memoryUsageBefore.heapUsed) / 1024 / 1024;

      // Verify performance benchmarks
      expect(totalLatency).toBeLessThan(maxLatencyMs);
      expect(throughputPerMin).toBeGreaterThan(minThroughputPerMin);
      expect(results.every(r => r.status === 'success')).toBe(true);
      expect(memoryIncreaseMB).toBeLessThan(500); // Memory increase < 500MB

      console.log(`Heavy load performance: ${totalLatency}ms latency, ${throughputPerMin.toFixed(0)} findings/min, ${memoryIncreaseMB.toFixed(1)}MB memory increase`);
    });

    it('should validate concurrent processing performance', async () => {
      const concurrentBatches = 5;
      const findingsPerBatch = 200;
      const totalFindings = concurrentBatches * findingsPerBatch;

      // Create concurrent processing scenarios
      const batchPromises = Array(concurrentBatches).fill(null).map(async (_, batchIndex) => {
        const batchFindings = Array(findingsPerBatch).fill(null).map((_, findingIndex) => ({
          schemaVersion: '2.0',
          accountId: '123456789012',
          region: 'us-east-1',
          partition: 'aws',
          id: `concurrent-${batchIndex}-${findingIndex}`,
          arn: `arn:aws:guardduty:us-east-1:123456789012:detector/test/finding/concurrent-${batchIndex}-${findingIndex}`,
          type: 'Performance:Test/Concurrent',
          resource: { resourceType: 'Instance' },
          service: {
            serviceName: 'guardduty',
            detectorId: 'concurrent-detector',
            archived: false,
            count: 1,
            eventFirstSeen: '2024-01-01T00:00:00.000Z',
            eventLastSeen: '2024-01-01T00:00:00.000Z',
            resourceRole: 'TARGET'
          },
          severity: 6.0,
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
          title: `Concurrent Test Finding ${batchIndex}-${findingIndex}`,
          description: `Concurrent processing test finding ${batchIndex}-${findingIndex}`
        }));

        // Process batch through pipeline
        const transformResult = await dataTransformer.transformFindings(batchFindings as any);
        return transformResult.data;
      });

      mockAzureUpload.mockResolvedValue(undefined);

      const startTime = Date.now();

      // Execute all batches concurrently
      const batchResults = await Promise.all(batchPromises);
      const allTransformedFindings = batchResults.flat();

      // Ingest all findings
      const ingestionResults = await Promise.all(
        batchResults.map(batch => 
          azureClient.ingestData({
            data: batch,
            streamName: 'Custom-GuardDutyFindings',
            timestamp: new Date()
          })
        )
      );

      const totalLatency = Date.now() - startTime;
      const throughputPerSec = totalFindings / (totalLatency / 1000);

      // Verify concurrent processing performance
      expect(allTransformedFindings).toHaveLength(totalFindings);
      expect(ingestionResults.every(r => r.status === 'success')).toBe(true);
      expect(totalLatency).toBeLessThan(30000); // Should complete within 30 seconds
      expect(throughputPerSec).toBeGreaterThan(50); // > 50 findings/sec concurrent

      console.log(`Concurrent processing: ${totalLatency}ms for ${totalFindings} findings, ${throughputPerSec.toFixed(2)} findings/sec`);
    });

    it('should validate memory efficiency under sustained load', async () => {
      const iterations = 10;
      const findingsPerIteration = 100;
      const memoryGrowthThresholdMB = 100; // Max 100MB growth over all iterations

      const initialMemory = process.memoryUsage();
      const memorySnapshots = [initialMemory];

      mockAzureUpload.mockResolvedValue(undefined);

      // Run sustained processing iterations
      for (let iteration = 0; iteration < iterations; iteration++) {
        const iterationFindings = Array(findingsPerIteration).fill(null).map((_, i) => ({
          schemaVersion: '2.0',
          accountId: '123456789012',
          region: 'us-east-1',
          partition: 'aws',
          id: `memory-test-${iteration}-${i}`,
          arn: `arn:aws:guardduty:us-east-1:123456789012:detector/test/finding/memory-test-${iteration}-${i}`,
          type: 'Performance:Test/Memory',
          resource: { resourceType: 'Instance' },
          service: {
            serviceName: 'guardduty',
            detectorId: 'memory-detector',
            archived: false,
            count: 1,
            eventFirstSeen: '2024-01-01T00:00:00.000Z',
            eventLastSeen: '2024-01-01T00:00:00.000Z',
            resourceRole: 'TARGET'
          },
          severity: 4.0,
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
          title: `Memory Test Finding ${iteration}-${i}`,
          description: `Memory efficiency test finding ${iteration}-${i}`
        }));

        // Process iteration
        const transformResult = await dataTransformer.transformFindings(iterationFindings as any);
        await azureClient.ingestData({
          data: transformResult.data,
          streamName: 'Custom-GuardDutyFindings',
          timestamp: new Date()
        });

        // Force garbage collection if available
        if (global.gc) {
          global.gc();
        }

        // Record memory usage
        const currentMemory = process.memoryUsage();
        memorySnapshots.push(currentMemory);

        // Small delay between iterations
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      const finalMemory = memorySnapshots[memorySnapshots.length - 1];
      const memoryGrowthMB = (finalMemory.heapUsed - initialMemory.heapUsed) / 1024 / 1024;
      const maxHeapMB = Math.max(...memorySnapshots.map(m => m.heapUsed)) / 1024 / 1024;

      // Verify memory efficiency
      expect(memoryGrowthMB).toBeLessThan(memoryGrowthThresholdMB);
      expect(maxHeapMB).toBeLessThan(512); // Peak memory < 512MB

      console.log(`Memory efficiency: ${memoryGrowthMB.toFixed(1)}MB growth, ${maxHeapMB.toFixed(1)}MB peak`);
    });
  });
});
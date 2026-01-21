/**
 * Comprehensive testing utilities and helpers
 * Provides common test data, validation helpers, and assertion utilities
 */

import { GuardDutyFinding } from '../../src/types/guardduty';
import { ProcessingResult } from '../../src/services/jsonl-processor';
import { ProcessingBatch, ProcessingMetrics } from '../../src/types/configuration';

/**
 * Load sample findings from the samples directory
 */
export class SampleDataLoader {
  private static sampleCache: Map<string, any> = new Map();

  static async loadSampleFinding(filename: string): Promise<GuardDutyFinding> {
    if (this.sampleCache.has(filename)) {
      return this.sampleCache.get(filename);
    }

    try {
      const fs = require('fs').promises;
      const path = require('path');
      const filePath = path.join(__dirname, '../../samples/data/sample-findings', filename);
      const content = await fs.readFile(filePath, 'utf8');
      const finding = JSON.parse(content);
      this.sampleCache.set(filename, finding);
      return finding;
    } catch (error: any) {
      throw new Error(`Failed to load sample finding ${filename}: ${error?.message || 'Unknown error'}`);
    }
  }

  static async loadAllSampleFindings(): Promise<GuardDutyFinding[]> {
    const fs = require('fs').promises;
    const path = require('path');
    const findings: GuardDutyFinding[] = [];

    const sampleDirs = [
      'ec2-findings',
      's3-findings',
      'iam-findings',
      'kubernetes-findings',
      'malware-findings',
      'edge-cases'
    ];

    for (const dir of sampleDirs) {
      try {
        const dirPath = path.join(__dirname, '../../samples/data/sample-findings', dir);
        const files = await fs.readdir(dirPath);
        
        for (const file of files) {
          if (file.endsWith('.json')) {
            const finding = await this.loadSampleFinding(`${dir}/${file}`);
            findings.push(finding);
          }
        }
      } catch (error: any) {
        // Directory might not exist, continue
        console.warn(`Could not load samples from ${dir}: ${error?.message || 'Unknown error'}`);
      }
    }

    return findings;
  }

  static async loadMalformedSamples(): Promise<string[]> {
    const fs = require('fs').promises;
    const path = require('path');
    const samples: string[] = [];

    try {
      const dirPath = path.join(__dirname, '../../samples/data/sample-findings/malformed');
      const files = await fs.readdir(dirPath);
      
      for (const file of files) {
        const filePath = path.join(dirPath, file);
        const content = await fs.readFile(filePath, 'utf8');
        samples.push(content);
      }
    } catch (error: any) {
      console.warn(`Could not load malformed samples: ${error?.message || 'Unknown error'}`);
    }

    return samples;
  }
}

/**
 * Test data factory for creating consistent test objects
 */
export class TestDataFactory {
  static createMinimalGuardDutyFinding(overrides: Partial<GuardDutyFinding> = {}): GuardDutyFinding {
    return {
      schemaVersion: '2.0',
      accountId: '123456789012',
      region: 'us-east-1',
      partition: 'aws',
      id: 'test-finding-id',
      arn: 'arn:aws:guardduty:us-east-1:123456789012:detector/test-detector/finding/test-finding-id',
      type: 'Test:Minimal/Finding',
      resource: {
        resourceType: 'Instance'
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
      severity: 5.0,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      title: 'Test Finding',
      description: 'Test finding for unit tests',
      ...overrides
    };
  }

  static createCompleteGuardDutyFinding(overrides: Partial<GuardDutyFinding> = {}): GuardDutyFinding {
    return {
      schemaVersion: '2.0',
      accountId: '123456789012',
      region: 'us-east-1',
      partition: 'aws',
      id: 'complete-test-finding-id',
      arn: 'arn:aws:guardduty:us-east-1:123456789012:detector/test-detector/finding/complete-test-finding-id',
      type: 'Trojan:EC2/DNSDataExfiltration',
      resource: {
        resourceType: 'Instance',
        instanceDetails: {
          instanceId: 'i-1234567890abcdef0',
          instanceType: 't3.medium',
          launchTime: '2024-01-01T10:00:00.000Z',
          platform: 'linux',
          productCodes: [],
          iamInstanceProfile: {
            arn: 'arn:aws:iam::123456789012:instance-profile/EC2-Role',
            id: 'AIPAI23HZ27SI6FQMGNQ2'
          },
          networkInterfaces: [
            {
              networkInterfaceId: 'eni-12345678',
              privateDnsName: 'ip-10-0-0-1.ec2.internal',
              privateIpAddress: '10.0.0.1',
              publicDnsName: 'ec2-198-51-100-1.compute-1.amazonaws.com',
              publicIp: '198.51.100.1',
              subnetId: 'subnet-12345678',
              vpcId: 'vpc-12345678',
              securityGroups: [
                {
                  groupName: 'default',
                  groupId: 'sg-12345678'
                }
              ]
            }
          ],
          tags: [
            {
              key: 'Name',
              value: 'TestServer'
            },
            {
              key: 'Environment',
              value: 'Test'
            }
          ],
          instanceState: 'running',
          availabilityZone: 'us-east-1a',
          imageId: 'ami-12345678',
          imageDescription: 'Amazon Linux 2 AMI'
        }
      },
      service: {
        serviceName: 'guardduty',
        detectorId: 'test-detector-complete',
        action: {
          actionType: 'DNS_REQUEST',
          dnsRequestAction: {
            domain: 'malicious.example.com',
            protocol: 'UDP',
            blocked: false
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
        count: 5,
        eventFirstSeen: '2024-01-01T12:00:00.000Z',
        eventLastSeen: '2024-01-01T14:30:00.000Z',
        resourceRole: 'TARGET',
        additionalInfo: {
          value: '{"test": true}',
          type: 'default'
        },
        featureName: 'DnsLogs'
      },
      severity: 8.0,
      createdAt: '2024-01-01T12:00:00.000Z',
      updatedAt: '2024-01-01T14:30:00.000Z',
      title: 'Complete Test Finding',
      description: 'Complete test finding with all optional fields populated',
      ...overrides
    };
  }

  static createProcessingResult(overrides: Partial<ProcessingResult> = {}): ProcessingResult {
    return {
      totalLines: 10,
      validFindings: 8,
      invalidLines: 2,
      findings: [],
      errors: [],
      ...overrides
    };
  }

  static createBatchProcessingResult(overrides: Partial<ProcessingBatch> = {}): ProcessingBatch {
    return {
      batchId: 'test-batch-123',
      s3Objects: [],
      findings: [],
      processedCount: 5,
      failedCount: 0,
      retryCount: 0,
      status: 'completed',
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides
    };
  }

  static createRetryResult<T>(data: T, overrides: any = {}): any {
    return {
      success: true,
      data,
      attempts: 1,
      totalTime: 100,
      errors: [],
      ...overrides
    };
  }

  static createDeduplicationResult(overrides: any = {}): any {
    return {
      totalFindings: 10,
      uniqueFindings: 8,
      duplicatesRemoved: 2,
      duplicateIds: ['dup1', 'dup2'],
      processingTime: 50,
      ...overrides
    };
  }

  static createHealthCheckResult(overrides: any = {}): any {
    return {
      status: 'healthy',
      timestamp: new Date(),
      checks: {
        s3Access: { status: 'healthy', message: 'S3 access OK' },
        azureConnection: { status: 'healthy', message: 'Azure connection OK' },
        configuration: { status: 'healthy', message: 'Configuration valid' }
      },
      uptime: 3600,
      version: '1.0.0',
      ...overrides
    };
  }

  static createMetricsData(overrides: any = {}): any {
    return {
      timestamp: new Date(),
      metrics: {
        'findings.processed': 100,
        'findings.success': 95,
        'findings.failed': 5,
        'processing.latency': 250,
        'batch.size': 50
      },
      tags: {
        environment: 'test',
        region: 'us-east-1'
      },
      ...overrides
    };
  }
}

/**
 * Validation helpers for test assertions
 */
export class TestValidators {
  static isValidGuardDutyFinding(finding: any): boolean {
    const requiredFields = [
      'schemaVersion', 'accountId', 'region', 'partition', 'id', 'arn',
      'type', 'resource', 'service', 'severity', 'createdAt', 'updatedAt',
      'title', 'description'
    ];

    return requiredFields.every(field => finding.hasOwnProperty(field));
  }

  static isValidAccountId(accountId: string): boolean {
    return /^\d{12}$/.test(accountId);
  }

  static isValidSeverity(severity: number): boolean {
    return typeof severity === 'number' && severity >= 0.0 && severity <= 8.9;
  }

  static isValidTimestamp(timestamp: string): boolean {
    const date = new Date(timestamp);
    return !isNaN(date.getTime()) && timestamp.includes('T') && timestamp.includes('Z');
  }

  static isValidArn(arn: string): boolean {
    return /^arn:aws:guardduty:[a-z0-9-]+:\d{12}:detector\/[^\/]+\/finding\/[^\/]+$/.test(arn);
  }

  static validateProcessingResult(result: ProcessingResult): void {
    expect(result).toHaveProperty('totalLines');
    expect(result).toHaveProperty('validFindings');
    expect(result).toHaveProperty('invalidLines');
    expect(result).toHaveProperty('findings');
    expect(result).toHaveProperty('errors');

    expect(typeof result.totalLines).toBe('number');
    expect(typeof result.validFindings).toBe('number');
    expect(typeof result.invalidLines).toBe('number');
    expect(Array.isArray(result.findings)).toBe(true);
    expect(Array.isArray(result.errors)).toBe(true);

    // Logical validations
    expect(result.validFindings + result.invalidLines).toBeLessThanOrEqual(result.totalLines);
    expect(result.validFindings).toBe(result.findings.length);
  }

  static validateBatchProcessingResult(result: ProcessingBatch): void {
    expect(result).toHaveProperty('batchId');
    expect(result).toHaveProperty('s3Objects');
    expect(result).toHaveProperty('findings');
    expect(result).toHaveProperty('processedCount');
    expect(result).toHaveProperty('failedCount');
    expect(result).toHaveProperty('status');

    expect(typeof result.batchId).toBe('string');
    expect(Array.isArray(result.s3Objects)).toBe(true);
    expect(Array.isArray(result.findings)).toBe(true);
    expect(typeof result.processedCount).toBe('number');
    expect(typeof result.failedCount).toBe('number');
    expect(['pending', 'processing', 'completed', 'failed']).toContain(result.status);
  }

  static validateHealthCheckResult(result: any): void {
    expect(result).toHaveProperty('status');
    expect(result).toHaveProperty('timestamp');
    expect(result).toHaveProperty('checks');
    expect(result).toHaveProperty('uptime');
    expect(result).toHaveProperty('version');

    expect(['healthy', 'degraded', 'unhealthy']).toContain(result.status);
    expect(result.timestamp).toBeInstanceOf(Date);
    expect(typeof result.checks).toBe('object');
    expect(typeof result.uptime).toBe('number');
    expect(typeof result.version).toBe('string');

    // Validate individual checks
    Object.values(result.checks).forEach((check: any) => {
      expect(check).toHaveProperty('status');
      expect(check).toHaveProperty('message');
      expect(['healthy', 'degraded', 'unhealthy']).toContain(check.status);
      expect(typeof check.message).toBe('string');
    });
  }
}

/**
 * Test assertion helpers for common patterns
 */
export class TestAssertions {
  static expectValidGuardDutyFinding(finding: any): void {
    expect(TestValidators.isValidGuardDutyFinding(finding)).toBe(true);
    expect(TestValidators.isValidAccountId(finding.accountId)).toBe(true);
    expect(TestValidators.isValidSeverity(finding.severity)).toBe(true);
    expect(TestValidators.isValidTimestamp(finding.createdAt)).toBe(true);
    expect(TestValidators.isValidTimestamp(finding.updatedAt)).toBe(true);
    expect(TestValidators.isValidArn(finding.arn)).toBe(true);
  }

  static expectProcessingSuccess(result: ProcessingResult, expectedFindings: number): void {
    TestValidators.validateProcessingResult(result);
    expect(result.validFindings).toBe(expectedFindings);
    expect(result.errors).toHaveLength(0);
    expect(result.findings).toHaveLength(expectedFindings);
  }

  static expectProcessingFailure(result: ProcessingResult, expectedErrors: number): void {
    TestValidators.validateProcessingResult(result);
    expect(result.invalidLines).toBeGreaterThan(0);
    expect(result.errors).toHaveLength(expectedErrors);
  }

  static expectBatchProcessingSuccess(result: ProcessingBatch): void {
    TestValidators.validateBatchProcessingResult(result);
    expect(result.failedCount).toBe(0);
    expect(result.status).toBe('completed');
  }

  static expectRetrySuccess<T>(result: any): void {
    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.attempts).toBeGreaterThan(0);
    expect(result.totalTime).toBeGreaterThanOrEqual(0);
  }

  static expectRetryFailure<T>(result: any, maxAttempts: number): void {
    expect(result.success).toBe(false);
    expect(result.data).toBeUndefined();
    expect(result.attempts).toBe(maxAttempts);
    expect(result.errors).toHaveLength(maxAttempts);
  }

  static expectHealthy(result: any): void {
    TestValidators.validateHealthCheckResult(result);
    expect(result.status).toBe('healthy');
    Object.values(result.checks).forEach((check: any) => {
      expect(check.status).toBe('healthy');
    });
  }

  static expectUnhealthy(result: any): void {
    TestValidators.validateHealthCheckResult(result);
    expect(['degraded', 'unhealthy']).toContain(result.status);
  }
}

/**
 * Test utilities for common operations
 */
export class TestUtils {
  static async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  static createMockError(message: string, code?: string): Error {
    const error = new Error(message);
    if (code) {
      (error as any).code = code;
    }
    return error;
  }

  static createMockS3Object(key: string, size: number = 1024): any {
    return {
      Key: key,
      Size: size,
      LastModified: new Date(),
      ETag: '"abc123def456"',
      StorageClass: 'STANDARD'
    };
  }

  static createMockS3Response(objects: any[] = []): any {
    return {
      Contents: objects,
      IsTruncated: false,
      KeyCount: objects.length,
      MaxKeys: 1000
    };
  }

  static createMockReadableStream(content: string): any {
    const { Readable } = require('stream');
    return new Readable({
      read() {
        this.push(content);
        this.push(null);
      }
    });
  }

  static createCompressedContent(content: string): Buffer {
    const zlib = require('zlib');
    return zlib.gzipSync(Buffer.from(content));
  }

  static generateRandomString(length: number): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  static generateRandomAccountId(): string {
    return Math.floor(Math.random() * 900000000000 + 100000000000).toString();
  }

  static generateRandomFindingId(): string {
    return this.generateRandomString(32);
  }

  static createJSONLContent(findings: GuardDutyFinding[]): string {
    return findings.map(finding => JSON.stringify(finding)).join('\n');
  }

  static createMalformedJSONL(): string {
    return [
      '{"valid": "json"}',
      '{"invalid": json}', // Missing quotes
      '{"trailing": "comma",}', // Trailing comma
      '', // Empty line
      '{"another": "valid"}',
      '{', // Incomplete JSON
      'not json at all'
    ].join('\n');
  }

  static expectArrayContainsOnly<T>(array: T[], predicate: (item: T) => boolean): void {
    expect(array.length).toBeGreaterThan(0);
    array.forEach(item => {
      expect(predicate(item)).toBe(true);
    });
  }

  static expectArraysEqual<T>(actual: T[], expected: T[]): void {
    expect(actual).toHaveLength(expected.length);
    expected.forEach((item, index) => {
      expect(actual[index]).toEqual(item);
    });
  }

  static expectObjectsDeepEqual(actual: any, expected: any): void {
    expect(JSON.stringify(actual, Object.keys(actual).sort()))
      .toEqual(JSON.stringify(expected, Object.keys(expected).sort()));
  }
}

/**
 * Performance testing utilities
 */
export class PerformanceTestUtils {
  static async measureExecutionTime<T>(fn: () => Promise<T>): Promise<{ result: T; timeMs: number }> {
    const start = Date.now();
    const result = await fn();
    const timeMs = Date.now() - start;
    return { result, timeMs };
  }

  static expectExecutionTimeUnder(timeMs: number, maxTimeMs: number): void {
    expect(timeMs).toBeLessThan(maxTimeMs);
  }

  static expectThroughputAbove(itemsProcessed: number, timeMs: number, minItemsPerSecond: number): void {
    const itemsPerSecond = (itemsProcessed / timeMs) * 1000;
    expect(itemsPerSecond).toBeGreaterThan(minItemsPerSecond);
  }
}
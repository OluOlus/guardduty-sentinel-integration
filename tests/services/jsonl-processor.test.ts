/**
 * Unit tests for JSONLProcessor
 */

import { JSONLProcessor, JSONLProcessorError } from '../../src/services/jsonl-processor';
import { GuardDutyFinding } from '../../src/types/guardduty';
import { Readable } from 'stream';
import { createGzip } from 'zlib';

describe('JSONLProcessor', () => {
  let processor: JSONLProcessor;

  beforeEach(() => {
    processor = new JSONLProcessor();
  });

  const createSampleFinding = (id: string = 'test-finding-1'): GuardDutyFinding => ({
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
  });

  describe('constructor', () => {
    it('should create processor with default configuration', () => {
      const config = processor.getConfig();
      expect(config.maxLineLength).toBe(1024 * 1024);
      expect(config.skipInvalidLines).toBe(true);
      expect(config.validateSchema).toBe(true);
      expect(config.encoding).toBe('utf8');
    });

    it('should create processor with custom configuration', () => {
      const customProcessor = new JSONLProcessor({
        maxLineLength: 512,
        skipInvalidLines: false,
        validateSchema: false,
        encoding: 'ascii'
      });

      const config = customProcessor.getConfig();
      expect(config.maxLineLength).toBe(512);
      expect(config.skipInvalidLines).toBe(false);
      expect(config.validateSchema).toBe(false);
      expect(config.encoding).toBe('ascii');
    });
  });

  describe('processText', () => {
    it('should process valid JSONL text successfully', async () => {
      const finding1 = createSampleFinding('finding-1');
      const finding2 = createSampleFinding('finding-2');
      
      const jsonlText = [
        JSON.stringify(finding1),
        JSON.stringify(finding2),
        '' // Empty line should be skipped
      ].join('\n');

      const result = await processor.processText(jsonlText);

      expect(result.totalLines).toBe(3);
      expect(result.validFindings).toBe(2);
      expect(result.invalidLines).toBe(0);
      expect(result.errors).toHaveLength(0);
      expect(result.findings).toHaveLength(2);
      expect(result.findings[0].id).toBe('finding-1');
      expect(result.findings[1].id).toBe('finding-2');
    });

    it('should handle invalid JSON lines when skipInvalidLines is true', async () => {
      const finding = createSampleFinding();
      const jsonlText = [
        JSON.stringify(finding),
        '{ invalid json }',
        JSON.stringify(finding)
      ].join('\n');

      const result = await processor.processText(jsonlText);

      expect(result.totalLines).toBe(3);
      expect(result.validFindings).toBe(2);
      expect(result.invalidLines).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].lineNumber).toBe(2);
      expect(result.errors[0].error).toContain('Invalid JSON');
    });

    it('should throw error for invalid JSON when skipInvalidLines is false', async () => {
      const strictProcessor = new JSONLProcessor({ skipInvalidLines: false });
      const jsonlText = '{ invalid json }';

      await expect(strictProcessor.processText(jsonlText))
        .rejects.toThrow(JSONLProcessorError);
    });

    it('should validate schema when validateSchema is true', async () => {
      const invalidFinding = { id: 'test', invalid: true };
      const jsonlText = JSON.stringify(invalidFinding);

      const result = await processor.processText(jsonlText);

      expect(result.validFindings).toBe(0);
      expect(result.invalidLines).toBe(1);
      expect(result.errors[0].error).toContain('Missing required field');
    });

    it('should skip schema validation when validateSchema is false', async () => {
      const noValidationProcessor = new JSONLProcessor({ validateSchema: false });
      const invalidFinding = { id: 'test', invalid: true };
      const jsonlText = JSON.stringify(invalidFinding);

      const result = await noValidationProcessor.processText(jsonlText);

      expect(result.validFindings).toBe(1);
      expect(result.invalidLines).toBe(0);
    });
  });

  describe('validateFinding', () => {
    it('should validate correct GuardDuty finding', () => {
      const finding = createSampleFinding();
      expect(processor.validateFinding(finding)).toBe(true);
    });

    it('should reject finding with missing required fields', () => {
      const invalidFinding = { id: 'test' };
      expect(() => processor.validateFinding(invalidFinding))
        .toThrow('Missing required field: schemaVersion');
    });

    it('should reject finding with invalid accountId', () => {
      const finding = createSampleFinding();
      finding.accountId = 'invalid';
      expect(() => processor.validateFinding(finding))
        .toThrow('Invalid accountId: must be 12-digit string');
    });

    it('should reject finding with invalid severity', () => {
      const finding = createSampleFinding();
      finding.severity = 10.0;
      expect(() => processor.validateFinding(finding))
        .toThrow('Invalid severity: must be number between 0 and 8.9');
    });

    it('should reject finding with invalid dates', () => {
      const finding = createSampleFinding();
      finding.createdAt = 'invalid-date';
      expect(() => processor.validateFinding(finding))
        .toThrow('Invalid createdAt: must be valid ISO date string');
    });
  });

  describe('processCompressedStream', () => {
    it('should process gzip compressed stream', async () => {
      const finding = createSampleFinding();
      const jsonlText = JSON.stringify(finding);
      
      // Create gzip compressed stream
      const gzipStream = new Readable({
        read() {
          this.push(jsonlText);
          this.push(null);
        }
      }).pipe(createGzip());

      const result = await processor.processCompressedStream(gzipStream, 'gzip');

      expect(result.validFindings).toBe(1);
      expect(result.findings[0].id).toBe('test-finding-1');
    });

    it('should process uncompressed stream', async () => {
      const finding = createSampleFinding();
      const jsonlText = JSON.stringify(finding);
      
      const stream = new Readable({
        read() {
          this.push(jsonlText);
          this.push(null);
        }
      });

      const result = await processor.processCompressedStream(stream, 'none');

      expect(result.validFindings).toBe(1);
      expect(result.findings[0].id).toBe('test-finding-1');
    });
  });

  describe('processStreamWithCallback', () => {
    it('should process stream with callbacks', async () => {
      const finding = createSampleFinding();
      const jsonlText = JSON.stringify(finding);
      
      const stream = new Readable({
        read() {
          this.push(jsonlText);
          this.push(null);
        }
      });

      const findings: GuardDutyFinding[] = [];
      const errors: any[] = [];

      const result = await processor.processStreamWithCallback(
        stream,
        (finding) => { findings.push(finding); },
        (error) => { errors.push(error); },
        'none'
      );

      expect(result.validFindings).toBe(1);
      expect(findings).toHaveLength(1);
      expect(findings[0].id).toBe('test-finding-1');
      expect(errors).toHaveLength(0);
    });
  });

  describe('createTransformStream', () => {
    it('should create working transform stream', (done) => {
      const finding = createSampleFinding();
      const jsonlText = JSON.stringify(finding) + '\n';
      
      const stream = new Readable({
        read() {
          this.push(jsonlText);
          this.push(null);
        }
      });

      const transformStream = processor.createTransformStream();
      const results: any[] = [];

      transformStream.on('data', (item) => {
        results.push(item);
      });

      transformStream.on('end', () => {
        expect(results).toHaveLength(1);
        expect(results[0].type).toBe('finding');
        expect(results[0].data.id).toBe('test-finding-1');
        done();
      });

      stream.pipe(transformStream);
    });
  });
});
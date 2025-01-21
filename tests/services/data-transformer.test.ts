/**
 * Unit tests for DataTransformer
 */

import { DataTransformer, DataTransformerError } from '../../src/services/data-transformer';
import { GuardDutyFinding } from '../../src/types/guardduty';

describe('DataTransformer', () => {
  let transformer: DataTransformer;

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
      resourceRole: 'TARGET',
      action: {
        actionType: 'NETWORK_CONNECTION',
        networkConnectionAction: {
          connectionDirection: 'OUTBOUND',
          remoteIpDetails: {
            ipAddressV4: '192.168.1.100',
            country: {
              countryCode: 'US',
              countryName: 'United States'
            }
          },
          protocol: 'TCP',
          blocked: false
        }
      }
    },
    severity: 8.0,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    title: 'Test Finding',
    description: 'Test finding description'
  });

  beforeEach(() => {
    transformer = new DataTransformer({
      enableNormalization: false,
      includeRawJson: true,
      maxFieldLength: 1000,
      timezone: 'UTC'
    });
  });

  describe('constructor and configuration', () => {
    it('should create transformer with provided configuration', () => {
      const config = transformer.getConfig();
      expect(config.enableNormalization).toBe(false);
      expect(config.includeRawJson).toBe(true);
      expect(config.maxFieldLength).toBe(1000);
      expect(config.timezone).toBe('UTC');
    });

    it('should create transformer with default values', () => {
      const defaultTransformer = new DataTransformer({
        enableNormalization: true
      });
      const config = defaultTransformer.getConfig();
      expect(config.enableNormalization).toBe(true);
      expect(config.includeRawJson).toBe(true);
      expect(config.maxFieldLength).toBe(32768);
      expect(config.timezone).toBe('UTC');
    });

    it('should update configuration', () => {
      transformer.updateConfig({ enableNormalization: true, maxFieldLength: 500 });
      const config = transformer.getConfig();
      expect(config.enableNormalization).toBe(true);
      expect(config.maxFieldLength).toBe(500);
    });
  });

  describe('validateConfig', () => {
    it('should validate correct configuration', () => {
      expect(() => DataTransformer.validateConfig({
        enableNormalization: true,
        includeRawJson: false,
        maxFieldLength: 1000,
        timezone: 'UTC'
      })).not.toThrow();
    });

    it('should reject invalid enableNormalization', () => {
      expect(() => DataTransformer.validateConfig({
        enableNormalization: 'true' as any
      })).toThrow('enableNormalization must be a boolean');
    });

    it('should reject invalid maxFieldLength', () => {
      expect(() => DataTransformer.validateConfig({
        enableNormalization: true,
        maxFieldLength: -1
      })).toThrow('maxFieldLength must be a positive number');
    });
  });

  describe('createDefault', () => {
    it('should create transformer with default configuration', () => {
      const defaultTransformer = DataTransformer.createDefault();
      const config = defaultTransformer.getConfig();
      expect(config.enableNormalization).toBe(false);
      expect(config.includeRawJson).toBe(true);
    });

    it('should create transformer with normalization enabled', () => {
      const normalizedTransformer = DataTransformer.createDefault(true);
      const config = normalizedTransformer.getConfig();
      expect(config.enableNormalization).toBe(true);
    });
  });

  describe('transformSingleFinding - raw mode', () => {
    it('should transform finding to raw format', async () => {
      const finding = createSampleFinding();
      const result = await transformer.transformSingleFinding(finding);

      expect(result.FindingId).toBe('test-finding-1');
      expect(result.AccountId).toBe('123456789012');
      expect(result.Region).toBe('us-east-1');
      expect(result.Severity).toBe(8.0);
      expect(result.Type).toBe('Trojan:EC2/DNSDataExfiltration');
      expect(result.RawJson).toBe(JSON.stringify(finding));
      expect(result.TimeGenerated).toBeDefined();
    });

    it('should handle missing optional fields gracefully', async () => {
      const finding = createSampleFinding();
      (finding.resource as any).instanceDetails = undefined;
      
      const result = await transformer.transformSingleFinding(finding);
      expect(result.FindingId).toBe('test-finding-1');
      expect(result.RawJson).toBeDefined();
    });

    it('should truncate long strings', async () => {
      const shortTransformer = new DataTransformer({
        enableNormalization: false,
        maxFieldLength: 10
      });
      
      const finding = createSampleFinding();
      finding.title = 'This is a very long title that should be truncated';
      
      const result = await shortTransformer.transformSingleFinding(finding);
      expect(result.Type).toBe('Trojan:...');
    });
  });

  describe('transformSingleFinding - normalized mode', () => {
    beforeEach(() => {
      transformer.updateConfig({ enableNormalization: true });
    });

    it('should transform finding to normalized format', async () => {
      const finding = createSampleFinding();
      const result = await transformer.transformSingleFinding(finding);

      expect(result.FindingId).toBe('test-finding-1');
      expect(result.AccountId).toBe('123456789012');
      expect(result.Region).toBe('us-east-1');
      expect(result.Severity).toBe(8.0);
      expect(result.Type).toBe('Trojan:EC2/DNSDataExfiltration');
      expect(result.CreatedAt).toBe('2024-01-01T00:00:00.000Z');
      expect(result.UpdatedAt).toBe('2024-01-01T00:00:00.000Z');
      expect(result.Title).toBe('Test Finding');
      expect(result.Description).toBe('Test finding description');
      expect(result.Service).toBe('guardduty');
      expect(result.ResourceType).toBe('Instance');
      expect(result.InstanceId).toBe('i-1234567890abcdef0');
      expect(result.RemoteIpCountry).toBe('United States');
      expect(result.RemoteIpAddress).toBe('192.168.1.100');
      expect(result.RawJson).toBe(JSON.stringify(finding));
    });

    it('should handle missing instance details', async () => {
      const finding = createSampleFinding();
      (finding.resource as any).instanceDetails = undefined;
      
      const result = await transformer.transformSingleFinding(finding);
      expect(result.InstanceId).toBeUndefined();
      expect(result.FindingId).toBe('test-finding-1');
    });

    it('should handle missing remote IP details', async () => {
      const finding = createSampleFinding();
      (finding.service as any).action = undefined;
      
      const result = await transformer.transformSingleFinding(finding);
      expect(result.RemoteIpCountry).toBeUndefined();
      expect(result.RemoteIpAddress).toBeUndefined();
    });

    it('should extract remote IP from AWS API call action', async () => {
      const finding = createSampleFinding();
      finding.service.action = {
        actionType: 'AWS_API_CALL',
        awsApiCallAction: {
          api: 'DescribeInstances',
          serviceName: 'ec2',
          remoteIpDetails: {
            ipAddressV4: '10.0.0.1',
            country: {
              countryCode: 'CA',
              countryName: 'Canada'
            }
          }
        }
      };
      
      const result = await transformer.transformSingleFinding(finding);
      expect(result.RemoteIpCountry).toBe('Canada');
      expect(result.RemoteIpAddress).toBe('10.0.0.1');
    });

    it('should exclude raw JSON when configured', async () => {
      transformer.updateConfig({ includeRawJson: false });
      const finding = createSampleFinding();
      
      const result = await transformer.transformSingleFinding(finding);
      expect(result.RawJson).toBeUndefined();
    });
  });

  describe('transformFindings', () => {
    it('should transform multiple findings successfully', async () => {
      const findings = [
        createSampleFinding('finding-1'),
        createSampleFinding('finding-2'),
        createSampleFinding('finding-3')
      ];

      const result = await transformer.transformFindings(findings);

      expect(result.transformedCount).toBe(3);
      expect(result.failedCount).toBe(0);
      expect(result.errors).toHaveLength(0);
      expect(result.data).toHaveLength(3);
      expect(result.mode).toBe('raw');
      expect(result.data[0].FindingId).toBe('finding-1');
      expect(result.data[1].FindingId).toBe('finding-2');
      expect(result.data[2].FindingId).toBe('finding-3');
    });

    it('should handle transformation errors gracefully', async () => {
      const findings = [
        createSampleFinding('finding-1'),
        { id: 'invalid-finding' } as any, // Invalid finding
        createSampleFinding('finding-3')
      ];

      const result = await transformer.transformFindings(findings);

      expect(result.transformedCount).toBe(2);
      expect(result.failedCount).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].findingIndex).toBe(1);
      expect(result.errors[0].findingId).toBe('invalid-finding');
      expect(result.data).toHaveLength(2);
    });

    it('should report correct mode for normalized transformation', async () => {
      transformer.updateConfig({ enableNormalization: true });
      const findings = [createSampleFinding()];

      const result = await transformer.transformFindings(findings);

      expect(result.mode).toBe('normalized');
      expect(result.transformedCount).toBe(1);
    });
  });

  describe('severity normalization', () => {
    it('should clamp severity to valid range', async () => {
      const finding = createSampleFinding();
      
      // Test upper bound
      finding.severity = 10.0;
      let result = await transformer.transformSingleFinding(finding);
      expect(result.Severity).toBe(8.9);

      // Test lower bound
      finding.severity = -1.0;
      result = await transformer.transformSingleFinding(finding);
      expect(result.Severity).toBe(0.0);

      // Test NaN
      finding.severity = NaN;
      result = await transformer.transformSingleFinding(finding);
      expect(result.Severity).toBe(0.0);
    });
  });

  describe('custom field mappings', () => {
    it('should apply custom field mappings', async () => {
      const customTransformer = new DataTransformer({
        enableNormalization: false,
        customFieldMappings: {
          'FindingId': 'CustomFindingId',
          'AccountId': 'CustomAccountId'
        }
      });

      const finding = createSampleFinding();
      const result = await customTransformer.transformSingleFinding(finding);

      expect(result.CustomFindingId).toBe('test-finding-1');
      expect(result.CustomAccountId).toBe('123456789012');
      expect(result.FindingId).toBeUndefined();
      expect(result.AccountId).toBeUndefined();
    });
  });

  describe('error handling', () => {
    it('should throw error for missing required fields', async () => {
      const invalidFinding = { id: 'test' } as any;

      await expect(transformer.transformSingleFinding(invalidFinding))
        .rejects.toThrow(DataTransformerError);
    });

    it('should throw error for invalid service structure', async () => {
      const finding = createSampleFinding();
      (finding.service as any).serviceName = undefined;

      await expect(transformer.transformSingleFinding(finding))
        .rejects.toThrow('Missing required field: service.serviceName');
    });

    it('should throw error for invalid resource structure', async () => {
      const finding = createSampleFinding();
      (finding.resource as any).resourceType = undefined;

      await expect(transformer.transformSingleFinding(finding))
        .rejects.toThrow('Missing required field: resource.resourceType');
    });

    it('should throw error for invalid date fields', async () => {
      const finding = createSampleFinding();
      finding.createdAt = 'invalid-date';

      await expect(transformer.transformSingleFinding(finding))
        .rejects.toThrow('Invalid date format');
    });
  });
});
/**
 * Unit tests for GuardDuty type definitions
 */

import { GuardDutyFinding } from '../../src/types/guardduty';

describe('GuardDuty Types', () => {
  describe('GuardDutyFinding', () => {
    it('should accept a valid GuardDuty finding structure', () => {
      const finding: GuardDutyFinding = {
        schemaVersion: '2.0',
        accountId: '123456789012',
        region: 'us-east-1',
        partition: 'aws',
        id: 'test-finding-id',
        arn: 'arn:aws:guardduty:us-east-1:123456789012:detector/test-detector/finding/test-finding-id',
        type: 'Trojan:EC2/DNSDataExfiltration',
        resource: {
          resourceType: 'Instance',
          instanceDetails: {
            instanceId: 'i-1234567890abcdef0',
            instanceType: 't2.micro',
            instanceState: 'running',
            availabilityZone: 'us-east-1a',
          },
        },
        service: {
          serviceName: 'guardduty',
          detectorId: 'test-detector',
          archived: false,
          count: 1,
          eventFirstSeen: '2024-01-01T00:00:00.000Z',
          eventLastSeen: '2024-01-01T00:00:00.000Z',
          resourceRole: 'TARGET',
        },
        severity: 8.0,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        title: 'Test GuardDuty Finding',
        description: 'Test finding description',
      };

      expect(finding.accountId).toBe('123456789012');
      expect(finding.severity).toBe(8.0);
      expect(finding.resource.resourceType).toBe('Instance');
      expect(finding.service.serviceName).toBe('guardduty');
    });

    it('should handle optional fields correctly', () => {
      const finding: GuardDutyFinding = {
        schemaVersion: '2.0',
        accountId: '123456789012',
        region: 'us-east-1',
        partition: 'aws',
        id: 'test-finding-id',
        arn: 'arn:aws:guardduty:us-east-1:123456789012:detector/test-detector/finding/test-finding-id',
        type: 'Trojan:EC2/DNSDataExfiltration',
        resource: {
          resourceType: 'Instance',
        },
        service: {
          serviceName: 'guardduty',
          detectorId: 'test-detector',
          archived: false,
          count: 1,
          eventFirstSeen: '2024-01-01T00:00:00.000Z',
          eventLastSeen: '2024-01-01T00:00:00.000Z',
          resourceRole: 'TARGET',
        },
        severity: 8.0,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        title: 'Test GuardDuty Finding',
        description: 'Test finding description',
      };

      expect(finding.resource.instanceDetails).toBeUndefined();
      expect(finding.resource.s3BucketDetails).toBeUndefined();
    });

    it('should support network connection action details', () => {
      const finding: GuardDutyFinding = {
        schemaVersion: '2.0',
        accountId: '123456789012',
        region: 'us-east-1',
        partition: 'aws',
        id: 'test-finding-id',
        arn: 'arn:aws:guardduty:us-east-1:123456789012:detector/test-detector/finding/test-finding-id',
        type: 'Trojan:EC2/DNSDataExfiltration',
        resource: {
          resourceType: 'Instance',
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
                ipAddressV4: '198.51.100.1',
                country: {
                  countryCode: 'US',
                  countryName: 'United States',
                },
              },
              protocol: 'TCP',
              blocked: false,
            },
          },
        },
        severity: 8.0,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        title: 'Test GuardDuty Finding',
        description: 'Test finding description',
      };

      expect(finding.service.action?.actionType).toBe('NETWORK_CONNECTION');
      expect(finding.service.action?.networkConnectionAction?.remoteIpDetails.ipAddressV4).toBe(
        '198.51.100.1'
      );
      expect(
        finding.service.action?.networkConnectionAction?.remoteIpDetails.country?.countryName
      ).toBe('United States');
    });
  });
});

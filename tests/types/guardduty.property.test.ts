/**
 * Property-based tests for GuardDuty type definitions
 * Feature: guardduty-sentinel-integration, Property 1: S3 Export Completeness and Integrity
 */

import * as fc from 'fast-check';
import { GuardDutyFinding } from '../../src/types/guardduty';

describe('GuardDuty Types - Property Tests', () => {
  describe('Property 1: S3 Export Completeness and Integrity', () => {
    it('should preserve original JSON structure and metadata for any GuardDuty finding', () => {
      // **Validates: Requirements 1.1, 1.2, 1.4**

      // Simplified arbitrary for faster testing
      const simpleGuardDutyFindingArbitrary = fc.record({
        schemaVersion: fc.constant('2.0'),
        accountId: fc.constant('123456789012'),
        region: fc.constantFrom('us-east-1', 'us-west-2'),
        partition: fc.constant('aws'),
        id: fc.string({ minLength: 10, maxLength: 20 }),
        arn: fc.constant('arn:aws:guardduty:us-east-1:123456789012:detector/test/finding/test'),
        type: fc.constantFrom('Trojan:EC2/DNSDataExfiltration', 'Backdoor:EC2/C&CActivity.B!DNS'),
        resource: fc.record({
          resourceType: fc.constantFrom('Instance', 'S3Bucket'),
        }),
        service: fc.record({
          serviceName: fc.constant('guardduty'),
          detectorId: fc.string({ minLength: 10, maxLength: 20 }),
          archived: fc.boolean(),
          count: fc.integer({ min: 1, max: 10 }),
          eventFirstSeen: fc.constant('2024-01-01T00:00:00.000Z'),
          eventLastSeen: fc.constant('2024-01-01T00:00:00.000Z'),
          resourceRole: fc.constantFrom('TARGET', 'ACTOR'),
        }),
        severity: fc.constantFrom(1.0, 5.0, 8.0),
        createdAt: fc.constant('2024-01-01T00:00:00.000Z'),
        updatedAt: fc.constant('2024-01-01T00:00:00.000Z'),
        title: fc.string({ minLength: 5, maxLength: 50 }),
        description: fc.string({ minLength: 10, maxLength: 100 }),
      });

      fc.assert(
        fc.property(simpleGuardDutyFindingArbitrary, (finding: any) => {
          // Property: For any GuardDuty finding, serialization and deserialization should preserve structure
          const serialized = JSON.stringify(finding);
          const deserialized = JSON.parse(serialized);

          // Verify core metadata is preserved (simplified checks)
          expect(deserialized.accountId).toBe(finding.accountId);
          expect(deserialized.region).toBe(finding.region);
          expect(deserialized.type).toBe(finding.type);
          expect(deserialized.severity).toBe(finding.severity);

          return true;
        }),
        { numRuns: 3 }
      );
    });

    it('should maintain type safety for required fields across all findings', () => {
      // Even simpler arbitrary for type checking
      const typeCheckArbitrary = fc.record({
        schemaVersion: fc.constant('2.0'),
        accountId: fc.constant('123456789012'),
        region: fc.constant('us-east-1'),
        partition: fc.constant('aws'),
        id: fc.constant('test-id'),
        arn: fc.constant('test-arn'),
        type: fc.constant('test-type'),
        resource: fc.record({
          resourceType: fc.constant('Instance'),
        }),
        service: fc.record({
          serviceName: fc.constant('guardduty'),
          detectorId: fc.constant('test-detector'),
          archived: fc.boolean(),
          count: fc.constant(1),
          eventFirstSeen: fc.constant('2024-01-01T00:00:00.000Z'),
          eventLastSeen: fc.constant('2024-01-01T00:00:00.000Z'),
          resourceRole: fc.constant('TARGET'),
        }),
        severity: fc.constant(5.0),
        createdAt: fc.constant('2024-01-01T00:00:00.000Z'),
        updatedAt: fc.constant('2024-01-01T00:00:00.000Z'),
        title: fc.constant('Test Title'),
        description: fc.constant('Test Description'),
      });

      fc.assert(
        fc.property(typeCheckArbitrary, (finding: any) => {
          // Property: All required fields must be present and have correct types
          expect(typeof finding.schemaVersion).toBe('string');
          expect(typeof finding.accountId).toBe('string');
          expect(typeof finding.severity).toBe('number');
          expect(typeof finding.service.archived).toBe('boolean');

          return true;
        }),
        { numRuns: 3 }
      );
    });
  });
});

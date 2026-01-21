/**
 * Property-based tests for KQL Parser field extraction (simplified)
 * Feature: guardduty-sentinel-integration, Property 9: KQL Parser Field Extraction
 */

import * as fc from 'fast-check';
import { KqlParser } from '../../src/services/kql-parser';

describe('KqlParser - Property Tests (Simplified)', () => {
  describe('Property 9: KQL Parser Field Extraction', () => {
    it('should extract standard fields from valid GuardDuty finding JSON', () => {
      // **Validates: Requirements 5.1, 5.2**

      const parser = new KqlParser();

      // Simplified GuardDuty finding generator
      const simpleFindingArbitrary = fc.record({
        accountId: fc.constant('123456789012'),
        region: fc.constantFrom('us-east-1', 'us-west-2'),
        id: fc.string({ minLength: 10, maxLength: 20 }),
        type: fc.constantFrom('Trojan:EC2/DNSDataExfiltration', 'Malware:EC2/SuspiciousBehavior'),
        severity: fc.integer({ min: 0, max: 8 }),
        createdAt: fc.constant('2023-01-01T00:00:00Z'),
        updatedAt: fc.constant('2023-01-01T00:00:00Z'),
        title: fc.string({ minLength: 5, maxLength: 50 }),
        description: fc.string({ minLength: 10, maxLength: 100 }),
        resource: fc.record({
          resourceType: fc.constantFrom('Instance', 'S3Bucket')
        }),
        service: fc.record({
          serviceName: fc.constant('guardduty')
        })
      });

      fc.assert(
        fc.asyncProperty(simpleFindingArbitrary, async (finding) => {
          // Property: For any valid GuardDuty finding JSON, the parser should extract standard fields
          
          const rawJson = JSON.stringify(finding);
          const result = await parser.parseFields(rawJson);

          // Core fields should be extractable
          expect(result.extracted.Service).toBe('guardduty');
          expect(result.extracted.ResourceType).toBeDefined();
          expect(['Instance', 'S3Bucket'].includes(result.extracted.ResourceType as string)).toBe(true);
          
          // String fields should match original
          expect(result.extracted.Title).toBe(finding.title);
          expect(result.extracted.Description).toBe(finding.description);
          
          // Should not have errors for valid JSON
          expect(result.errors.length).toBe(0);
        }),
        { numRuns: 10 }
      );
    });

    it('should handle malformed JSON gracefully', () => {
      // **Validates: Requirements 5.1, 5.2**

      const parser = new KqlParser();

      const malformedJsonArbitrary = fc.constantFrom(
        '{ invalid json }',
        '{ "unclosed": "string',
        'null'
      );

      fc.assert(
        fc.asyncProperty(malformedJsonArbitrary, async (malformedJson) => {
          // Property: Malformed JSON should be handled gracefully with appropriate errors
          
          const result = await parser.parseFields(malformedJson);

          // Should have parsing errors for malformed JSON
          expect(result.errors.length).toBeGreaterThan(0);
          
          // Should not crash
          expect(result).toBeDefined();
          expect(result.extracted).toBeDefined();
          expect(result.failed).toBeDefined();
          expect(result.errors).toBeDefined();
        }),
        { numRuns: 5 }
      );
    });
  });
});
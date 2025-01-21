/**
 * Property-based tests for JSONLProcessor JSON validation consistency
 * Feature: guardduty-sentinel-integration, Property 3: JSON Validation Consistency
 */

import * as fc from 'fast-check';
import { JSONLProcessor } from '../../src/services/jsonl-processor';
import { GuardDutyFinding } from '../../src/types/guardduty';

describe('JSONLProcessor - Property Tests', () => {
  describe('Property 3: JSON Validation Consistency', () => {
    it('should accept valid JSON and reject invalid JSON consistently', () => {
      // **Validates: Requirements 2.4**

      const processor = new JSONLProcessor({ skipInvalidLines: true, validateSchema: false });

      // Generate valid JSON objects (simplified GuardDuty-like structure)
      const validJsonArbitrary = fc.record({
        id: fc.string({ minLength: 1, maxLength: 50 }),
        type: fc.string({ minLength: 1, maxLength: 100 }),
        data: fc.oneof(
          fc.string(),
          fc.integer(),
          fc.boolean(),
          fc.record({
            nested: fc.string(),
            value: fc.integer()
          })
        )
      });

      // Generate invalid JSON strings (excluding empty strings which are skipped)
      const invalidJsonArbitrary = fc.oneof(
        fc.constant('{ invalid json }'),
        fc.constant('{ "unclosed": "string'),
        fc.constant('{ "trailing": "comma", }'),
        fc.constant('undefined'),
        fc.constant('null'), // Valid JSON but not an object
        fc.constant('{'),
        fc.constant('}'),
        fc.constant('{ "key": }'),
        fc.constant('{ : "value" }'),
        fc.constant('{ "key" "value" }'),
        fc.constant('{ key: "value" }'), // unquoted key
        fc.constant('[1,2,3,]') // trailing comma in array
      );

      fc.assert(
        fc.asyncProperty(validJsonArbitrary, async (validObject) => {
          // Property: Valid JSON objects should be accepted for processing
          const jsonString = JSON.stringify(validObject);
          const result = await processor.processText(jsonString);

          // Valid JSON should result in successful parsing
          expect(result.validFindings).toBe(1);
          expect(result.invalidLines).toBe(0);
          expect(result.errors).toHaveLength(0);
          expect(result.findings).toHaveLength(1);

          return true;
        }),
        { numRuns: 50 }
      );

      fc.assert(
        fc.asyncProperty(invalidJsonArbitrary, async (invalidJson) => {
          // Property: Invalid JSON should be rejected with appropriate error handling
          const result = await processor.processText(invalidJson);

          // Skip empty strings as they are handled differently (skipped entirely)
          if (invalidJson.trim() === '') {
            expect(result.validFindings).toBe(0);
            expect(result.invalidLines).toBe(0);
            expect(result.errors).toHaveLength(0);
            expect(result.findings).toHaveLength(0);
          } else {
            // Invalid JSON should result in parsing errors
            expect(result.validFindings).toBe(0);
            expect(result.invalidLines).toBe(1);
            expect(result.errors).toHaveLength(1);
            expect(result.findings).toHaveLength(0);

            // Error should contain meaningful information
            const error = result.errors[0];
            expect(error.lineNumber).toBe(1);
            expect(error.error).toMatch(/Invalid JSON|Parsed JSON is not an object|Parse error/);
            expect(error.timestamp).toBeInstanceOf(Date);
          }

          return true;
        }),
        { numRuns: 50 }
      );
    });

    it('should handle mixed valid and invalid JSON lines consistently', () => {
      // **Validates: Requirements 2.4**

      const processor = new JSONLProcessor({ skipInvalidLines: true, validateSchema: false });

      // Generate arrays of mixed valid and invalid JSON lines
      const mixedJsonArbitrary = fc.array(
        fc.oneof(
          // Valid JSON objects
          fc.record({
            id: fc.string({ minLength: 1, maxLength: 20 }),
            value: fc.integer()
          }).map(obj => JSON.stringify(obj)),
          // Invalid JSON strings
          fc.constantFrom(
            '{ invalid }',
            '{ "unclosed": "string',
            '{ "trailing": "comma", }',
            ''
          )
        ),
        { minLength: 1, maxLength: 10 }
      );

      fc.assert(
        fc.asyncProperty(mixedJsonArbitrary, async (jsonLines) => {
          // Property: Mixed valid/invalid JSON should be processed consistently
          const jsonlText = jsonLines.join('\n');
          const result = await processor.processText(jsonlText);

          // Count expected valid and invalid lines
          let expectedValid = 0;
          let expectedInvalid = 0;

          for (const line of jsonLines) {
            if (line.trim() === '') {
              continue; // Empty lines are skipped
            }
            
            try {
              JSON.parse(line);
              expectedValid++;
            } catch {
              expectedInvalid++;
            }
          }

          // Verify consistent processing
          expect(result.validFindings).toBe(expectedValid);
          expect(result.invalidLines).toBe(expectedInvalid);
          expect(result.errors).toHaveLength(expectedInvalid);
          expect(result.findings).toHaveLength(expectedValid);

          // Verify total lines processed
          const nonEmptyLines = jsonLines.filter(line => line.trim() !== '').length;
          expect(result.validFindings + result.invalidLines).toBe(nonEmptyLines);

          return true;
        }),
        { numRuns: 30 }
      );
    });

    it('should validate GuardDuty schema consistently when schema validation is enabled', () => {
      // **Validates: Requirements 2.4**

      const processorWithValidation = new JSONLProcessor({ 
        skipInvalidLines: true, 
        validateSchema: true 
      });

      // Generate valid GuardDuty finding structure
      const validGuardDutyArbitrary = fc.record({
        schemaVersion: fc.constant('2.0'),
        accountId: fc.constant('123456789012'),
        region: fc.constantFrom('us-east-1', 'us-west-2'),
        partition: fc.constant('aws'),
        id: fc.string({ minLength: 10, maxLength: 50 }),
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

      // Generate invalid GuardDuty findings (missing required fields)
      const invalidGuardDutyArbitrary = fc.oneof(
        // Missing required fields
        fc.record({
          id: fc.string(),
          // Missing other required fields
        }),
        // Invalid accountId
        fc.record({
          schemaVersion: fc.constant('2.0'),
          accountId: fc.constant('invalid-account'),
          region: fc.constant('us-east-1'),
          partition: fc.constant('aws'),
          id: fc.string(),
          arn: fc.constant('test-arn'),
          type: fc.constant('test-type'),
          resource: fc.record({ resourceType: fc.constant('Instance') }),
          service: fc.record({
            serviceName: fc.constant('guardduty'),
            detectorId: fc.constant('test'),
            archived: fc.boolean(),
            count: fc.constant(1),
            eventFirstSeen: fc.constant('2024-01-01T00:00:00.000Z'),
            eventLastSeen: fc.constant('2024-01-01T00:00:00.000Z'),
            resourceRole: fc.constant('TARGET'),
          }),
          severity: fc.constant(5.0),
          createdAt: fc.constant('2024-01-01T00:00:00.000Z'),
          updatedAt: fc.constant('2024-01-01T00:00:00.000Z'),
          title: fc.constant('Test'),
          description: fc.constant('Test'),
        }),
        // Invalid severity
        fc.record({
          schemaVersion: fc.constant('2.0'),
          accountId: fc.constant('123456789012'),
          region: fc.constant('us-east-1'),
          partition: fc.constant('aws'),
          id: fc.string(),
          arn: fc.constant('test-arn'),
          type: fc.constant('test-type'),
          resource: fc.record({ resourceType: fc.constant('Instance') }),
          service: fc.record({
            serviceName: fc.constant('guardduty'),
            detectorId: fc.constant('test'),
            archived: fc.boolean(),
            count: fc.constant(1),
            eventFirstSeen: fc.constant('2024-01-01T00:00:00.000Z'),
            eventLastSeen: fc.constant('2024-01-01T00:00:00.000Z'),
            resourceRole: fc.constant('TARGET'),
          }),
          severity: fc.constant(10.0), // Invalid severity > 8.9
          createdAt: fc.constant('2024-01-01T00:00:00.000Z'),
          updatedAt: fc.constant('2024-01-01T00:00:00.000Z'),
          title: fc.constant('Test'),
          description: fc.constant('Test'),
        })
      );

      fc.assert(
        fc.asyncProperty(validGuardDutyArbitrary, async (validFinding) => {
          // Property: Valid GuardDuty findings should pass schema validation
          const jsonString = JSON.stringify(validFinding);
          const result = await processorWithValidation.processText(jsonString);

          expect(result.validFindings).toBe(1);
          expect(result.invalidLines).toBe(0);
          expect(result.errors).toHaveLength(0);

          return true;
        }),
        { numRuns: 20 }
      );

      fc.assert(
        fc.asyncProperty(invalidGuardDutyArbitrary, async (invalidFinding) => {
          // Property: Invalid GuardDuty findings should fail schema validation
          const jsonString = JSON.stringify(invalidFinding);
          const result = await processorWithValidation.processText(jsonString);

          expect(result.validFindings).toBe(0);
          expect(result.invalidLines).toBe(1);
          expect(result.errors).toHaveLength(1);

          // Error should indicate schema validation failure
          const error = result.errors[0];
          expect(error.error).toMatch(/Missing required field|Invalid/);

          return true;
        }),
        { numRuns: 20 }
      );
    });

    it('should handle edge cases in JSON validation consistently', () => {
      // **Validates: Requirements 2.4**

      const processor = new JSONLProcessor({ skipInvalidLines: true, validateSchema: false });

      // Generate edge case JSON strings
      const edgeCaseArbitrary = fc.oneof(
        // Empty and whitespace
        fc.constant(''),
        fc.constant('   '),
        fc.constant('\n'),
        fc.constant('\t'),
        // Special JSON values
        fc.constant('null'),
        fc.constant('true'),
        fc.constant('false'),
        fc.constant('0'),
        fc.constant('""'),
        fc.constant('[]'),
        fc.constant('{}'),
        // Large valid JSON
        fc.record({
          data: fc.string({ minLength: 1000, maxLength: 2000 })
        }).map(obj => JSON.stringify(obj)),
        // Unicode and special characters
        fc.record({
          unicode: fc.constant('测试'),
          emoji: fc.constant('🔒'),
          special: fc.constant('\\n\\t\\r')
        }).map(obj => JSON.stringify(obj))
      );

      fc.assert(
        fc.asyncProperty(edgeCaseArbitrary, async (edgeCase) => {
          // Property: Edge cases should be handled consistently
          const result = await processor.processText(edgeCase);

          // Verify consistent behavior
          if (edgeCase.trim() === '') {
            // Empty lines should be skipped
            expect(result.totalLines).toBeGreaterThanOrEqual(0);
            expect(result.validFindings).toBe(0);
            expect(result.invalidLines).toBe(0);
          } else {
            try {
              const parsed = JSON.parse(edgeCase);
              if (parsed && typeof parsed === 'object') {
                // Valid object JSON should be accepted
                expect(result.validFindings).toBe(1);
                expect(result.invalidLines).toBe(0);
              } else {
                // Primitive JSON values should be rejected (not objects)
                expect(result.validFindings).toBe(0);
                expect(result.invalidLines).toBe(1);
              }
            } catch {
              // Invalid JSON should be rejected
              expect(result.validFindings).toBe(0);
              expect(result.invalidLines).toBe(1);
            }
          }

          return true;
        }),
        { numRuns: 30 }
      );
    });
  });
});
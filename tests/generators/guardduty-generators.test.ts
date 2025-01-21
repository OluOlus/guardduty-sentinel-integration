/**
 * Tests for GuardDuty generators
 */

import * as fc from 'fast-check';
import { 
  severityArbitrary,
  accountIdArbitrary,
  findingIdArbitrary,
  timestampArbitrary,
  simpleGuardDutyFindingArbitrary,
  edgeCaseGuardDutyFindingArbitrary
} from './guardduty-generators';
import { TestValidators } from '../utils/test-helpers';

describe('GuardDuty Generators', () => {
  describe('Basic Arbitraries', () => {
    it('should generate valid severity values', () => {
      fc.assert(
        fc.property(severityArbitrary, (severity) => {
          expect(TestValidators.isValidSeverity(severity)).toBe(true);
          expect(severity).toBeGreaterThanOrEqual(0.0);
          expect(severity).toBeLessThanOrEqual(8.9);
          return true;
        }),
        { numRuns: 10 }
      );
    });

    it('should generate valid account IDs', () => {
      fc.assert(
        fc.property(accountIdArbitrary, (accountId) => {
          expect(TestValidators.isValidAccountId(accountId)).toBe(true);
          expect(accountId).toHaveLength(12);
          expect(/^\d{12}$/.test(accountId)).toBe(true);
          return true;
        }),
        { numRuns: 10 }
      );
    });

    it('should generate valid timestamps', () => {
      fc.assert(
        fc.property(timestampArbitrary, (timestamp) => {
          expect(TestValidators.isValidTimestamp(timestamp)).toBe(true);
          expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
          return true;
        }),
        { numRuns: 10 }
      );
    });
  });

  describe('simpleGuardDutyFindingArbitrary', () => {
    it('should generate simplified valid findings', () => {
      fc.assert(
        fc.property(simpleGuardDutyFindingArbitrary, (finding) => {
          expect(finding).toHaveProperty('schemaVersion', '2.0');
          expect(finding).toHaveProperty('accountId', '123456789012');
          expect(finding).toHaveProperty('partition', 'aws');
          expect(['us-east-1', 'us-west-2']).toContain(finding.region);
          return true;
        }),
        { numRuns: 10 }
      );
    });
  });

  describe('edgeCaseGuardDutyFindingArbitrary', () => {
    it('should generate edge case findings', () => {
      fc.assert(
        fc.property(edgeCaseGuardDutyFindingArbitrary, (finding) => {
          // Edge cases should still be valid findings
          expect(TestValidators.isValidGuardDutyFinding(finding)).toBe(true);
          
          // Check for edge case characteristics
          const isMinimal = finding.severity === 0.0;
          const isMaximal = finding.severity === 8.9;
          const hasUnicode = finding.title?.includes('测试') || finding.id?.includes('测试');
          
          expect(isMinimal || isMaximal || hasUnicode).toBe(true);
          return true;
        }),
        { numRuns: 10 }
      );
    });
  });
});
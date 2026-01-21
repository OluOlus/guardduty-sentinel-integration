/**
 * Tests for test helpers and utilities
 */

import { 
  SampleDataLoader, 
  TestDataFactory, 
  TestValidators, 
  TestAssertions,
  TestUtils 
} from './test-helpers';

describe('Test Helpers', () => {
  describe('TestDataFactory', () => {
    it('should create minimal GuardDuty finding', () => {
      const finding = TestDataFactory.createMinimalGuardDutyFinding();
      
      expect(finding).toHaveProperty('schemaVersion', '2.0');
      expect(finding).toHaveProperty('accountId', '123456789012');
      expect(finding).toHaveProperty('region', 'us-east-1');
      expect(finding).toHaveProperty('severity', 5.0);
      expect(TestValidators.isValidGuardDutyFinding(finding)).toBe(true);
    });

    it('should create complete GuardDuty finding', () => {
      const finding = TestDataFactory.createCompleteGuardDutyFinding();
      
      expect(finding).toHaveProperty('schemaVersion', '2.0');
      expect(finding).toHaveProperty('type', 'Trojan:EC2/DNSDataExfiltration');
      expect(finding.resource).toHaveProperty('instanceDetails');
      expect(finding.service).toHaveProperty('action');
      expect(finding.service).toHaveProperty('evidence');
      expect(TestValidators.isValidGuardDutyFinding(finding)).toBe(true);
    });

    it('should apply overrides correctly', () => {
      const finding = TestDataFactory.createMinimalGuardDutyFinding({
        severity: 8.5,
        title: 'Custom Title'
      });
      
      expect(finding.severity).toBe(8.5);
      expect(finding.title).toBe('Custom Title');
    });
  });

  describe('TestValidators', () => {
    it('should validate valid GuardDuty finding', () => {
      const finding = TestDataFactory.createMinimalGuardDutyFinding();
      expect(TestValidators.isValidGuardDutyFinding(finding)).toBe(true);
    });

    it('should reject invalid GuardDuty finding', () => {
      const invalidFinding = { invalid: 'finding' };
      expect(TestValidators.isValidGuardDutyFinding(invalidFinding)).toBe(false);
    });

    it('should validate account IDs', () => {
      expect(TestValidators.isValidAccountId('123456789012')).toBe(true);
      expect(TestValidators.isValidAccountId('12345678901')).toBe(false); // Too short
      expect(TestValidators.isValidAccountId('1234567890123')).toBe(false); // Too long
      expect(TestValidators.isValidAccountId('12345678901a')).toBe(false); // Contains letter
    });

    it('should validate severity values', () => {
      expect(TestValidators.isValidSeverity(0.0)).toBe(true);
      expect(TestValidators.isValidSeverity(5.5)).toBe(true);
      expect(TestValidators.isValidSeverity(8.9)).toBe(true);
      expect(TestValidators.isValidSeverity(-0.1)).toBe(false);
      expect(TestValidators.isValidSeverity(9.0)).toBe(false);
    });

    it('should validate timestamps', () => {
      expect(TestValidators.isValidTimestamp('2024-01-01T00:00:00.000Z')).toBe(true);
      expect(TestValidators.isValidTimestamp('2024-01-01T12:30:45.123Z')).toBe(true);
      expect(TestValidators.isValidTimestamp('2024-01-01')).toBe(false);
      expect(TestValidators.isValidTimestamp('invalid')).toBe(false);
    });

    it('should validate ARNs', () => {
      const validArn = 'arn:aws:guardduty:us-east-1:123456789012:detector/test/finding/test';
      const invalidArn = 'arn:aws:s3:::bucket';
      
      expect(TestValidators.isValidArn(validArn)).toBe(true);
      expect(TestValidators.isValidArn(invalidArn)).toBe(false);
    });
  });

  describe('TestUtils', () => {
    it('should generate random strings', () => {
      const str1 = TestUtils.generateRandomString(10);
      const str2 = TestUtils.generateRandomString(10);
      
      expect(str1).toHaveLength(10);
      expect(str2).toHaveLength(10);
      expect(str1).not.toBe(str2);
      expect(/^[a-z0-9]+$/.test(str1)).toBe(true);
    });

    it('should generate random account IDs', () => {
      const accountId = TestUtils.generateRandomAccountId();
      
      expect(accountId).toHaveLength(12);
      expect(/^\d{12}$/.test(accountId)).toBe(true);
    });

    it('should create JSONL content', () => {
      const findings = [
        TestDataFactory.createMinimalGuardDutyFinding({ id: 'finding1' }),
        TestDataFactory.createMinimalGuardDutyFinding({ id: 'finding2' })
      ];
      
      const jsonl = TestUtils.createJSONLContent(findings);
      const lines = jsonl.split('\n');
      
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0]).id).toBe('finding1');
      expect(JSON.parse(lines[1]).id).toBe('finding2');
    });

    it('should create malformed JSONL', () => {
      const malformed = TestUtils.createMalformedJSONL();
      const lines = malformed.split('\n');
      
      expect(lines.length).toBeGreaterThan(5);
      
      // Should contain valid JSON
      expect(() => JSON.parse(lines[0])).not.toThrow();
      
      // Should contain invalid JSON
      expect(() => JSON.parse(lines[1])).toThrow();
    });

    it('should create compressed content', () => {
      const content = 'test content';
      const compressed = TestUtils.createCompressedContent(content);
      
      expect(Buffer.isBuffer(compressed)).toBe(true);
      expect(compressed.length).toBeGreaterThan(0);
      expect(compressed.length).not.toBe(content.length);
    });
  });
});
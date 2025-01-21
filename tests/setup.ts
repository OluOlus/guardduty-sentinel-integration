/**
 * Jest test setup configuration
 */

// Global test timeout
jest.setTimeout(30000);

// Mock console methods in tests to reduce noise
const originalConsole = console;

beforeAll(() => {
  global.console = {
    ...originalConsole,
    log: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: originalConsole.error, // Keep error for debugging
  };
});

afterAll(() => {
  global.console = originalConsole;
});

// Global test utilities
(global as any).testUtils = {
  createMockGuardDutyFinding: () => ({
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
    description: 'Test finding for unit tests',
  }),
};
/**
 * Unit tests for DeduplicationService
 */

import { DeduplicationService } from '../../src/services/deduplication-service';
import { DeduplicationConfig } from '../../src/types/configuration';
import { GuardDutyFinding } from '../../src/types/guardduty';

describe('DeduplicationService', () => {
  let config: DeduplicationConfig;
  let service: DeduplicationService;

  beforeEach(() => {
    config = {
      enabled: true,
      strategy: 'findingId',
      cacheSize: 100
    };
    service = new DeduplicationService(config);
  });

  describe('Finding ID Strategy', () => {
    it('should detect duplicate findings by ID', () => {
      const finding = createMockFinding('finding-1');
      
      expect(service.isDuplicate(finding)).toBe(false); // First occurrence
      expect(service.isDuplicate(finding)).toBe(true);  // Duplicate
    });

    it('should not detect different findings as duplicates', () => {
      const finding1 = createMockFinding('finding-1');
      const finding2 = createMockFinding('finding-2');
      
      expect(service.isDuplicate(finding1)).toBe(false);
      expect(service.isDuplicate(finding2)).toBe(false);
    });

    it('should emit duplicate-detected event', (done) => {
      const finding = createMockFinding('finding-1');
      
      service.on('duplicate-detected', (findingId, strategy) => {
        expect(findingId).toBe('finding-1');
        expect(strategy).toBe('findingId');
        done();
      });
      
      service.isDuplicate(finding); // First occurrence
      service.isDuplicate(finding); // Duplicate
    });
  });

  describe('Content Hash Strategy', () => {
    beforeEach(() => {
      config.strategy = 'contentHash';
      service = new DeduplicationService(config);
    });

    it('should detect duplicates with same content', () => {
      const finding1 = createMockFinding('finding-1');
      const finding2 = createMockFinding('finding-2'); // Different ID, same content
      
      expect(service.isDuplicate(finding1)).toBe(false);
      expect(service.isDuplicate(finding2)).toBe(true); // Same content hash
    });

    it('should not detect duplicates with different content', () => {
      const finding1 = createMockFinding('finding-1');
      const finding2 = createMockFinding('finding-2');
      finding2.type = 'Different:Type'; // Change content
      
      expect(service.isDuplicate(finding1)).toBe(false);
      expect(service.isDuplicate(finding2)).toBe(false); // Different content
    });
  });

  describe('Time Window Strategy', () => {
    beforeEach(() => {
      config.strategy = 'timeWindow';
      config.timeWindowMinutes = 5; // 5 minute window
      service = new DeduplicationService(config);
    });

    it('should detect duplicates within time window', () => {
      const finding = createMockFinding('finding-1');
      
      expect(service.isDuplicate(finding)).toBe(false); // First occurrence
      expect(service.isDuplicate(finding)).toBe(true);  // Within window
    });

    it('should not detect duplicates outside time window', (done) => {
      const finding = createMockFinding('finding-1');
      
      // Mock time window expiration
      config.timeWindowMinutes = 0.001; // Very short window
      service = new DeduplicationService(config);
      
      expect(service.isDuplicate(finding)).toBe(false); // First occurrence
      
      setTimeout(() => {
        expect(service.isDuplicate(finding)).toBe(false); // Outside window
        done();
      }, 100); // Increased timeout to ensure window expires
    }, 10000); // Increased test timeout
  });
  describe('Cache Management', () => {
    it('should respect cache size limits', () => {
      config.cacheSize = 2;
      service = new DeduplicationService(config);
      
      const finding1 = createMockFinding('finding-1');
      const finding2 = createMockFinding('finding-2');
      const finding3 = createMockFinding('finding-3');
      
      service.isDuplicate(finding1);
      service.isDuplicate(finding2);
      service.isDuplicate(finding3); // Should trigger eviction
      
      const stats = service.getCacheStats();
      expect(stats.size).toBeLessThanOrEqual(2);
    });

    it('should emit cache-evicted event', (done) => {
      config.cacheSize = 1;
      service = new DeduplicationService(config);
      
      service.on('cache-evicted', (evictedCount) => {
        expect(evictedCount).toBeGreaterThan(0);
        done();
      });
      
      service.isDuplicate(createMockFinding('finding-1'));
      service.isDuplicate(createMockFinding('finding-2')); // Triggers eviction
    });

    it('should clear cache', () => {
      const finding = createMockFinding('finding-1');
      
      service.isDuplicate(finding);
      expect(service.getCacheStats().size).toBe(1);
      
      service.clearCache();
      expect(service.getCacheStats().size).toBe(0);
      
      // Should not be duplicate after cache clear
      expect(service.isDuplicate(finding)).toBe(false);
    });
  });

  describe('Metrics Tracking', () => {
    it('should track processing metrics', () => {
      const finding1 = createMockFinding('finding-1');
      const finding2 = createMockFinding('finding-2');
      
      service.isDuplicate(finding1); // Not duplicate
      service.isDuplicate(finding1); // Duplicate
      service.isDuplicate(finding2); // Not duplicate
      
      const metrics = service.getMetrics();
      expect(metrics.totalProcessed).toBe(3);
      expect(metrics.duplicatesDetected).toBe(1);
      expect(metrics.deduplicationRate).toBeCloseTo(1/3);
    });

    it('should track cache hit rate', () => {
      const finding = createMockFinding('finding-1');
      
      service.isDuplicate(finding); // Cache miss
      service.isDuplicate(finding); // Cache hit
      
      const stats = service.getCacheStats();
      expect(stats.hitRate).toBe(0.5); // 1 hit out of 2 accesses
    });

    it('should emit metrics-updated event', (done) => {
      service.on('metrics-updated', (metrics) => {
        expect(metrics.totalProcessed).toBeGreaterThan(0);
        done();
      });
      
      service.isDuplicate(createMockFinding('finding-1'));
    });
  });

  describe('Batch Operations', () => {
    it('should filter duplicates from array', () => {
      const findings = [
        createMockFinding('finding-1'),
        createMockFinding('finding-2'),
        createMockFinding('finding-1'), // Duplicate
        createMockFinding('finding-3')
      ];
      
      const filtered = service.filterDuplicates(findings);
      
      expect(filtered).toHaveLength(3);
      expect(filtered.map(f => f.id)).toEqual(['finding-1', 'finding-2', 'finding-3']);
    });

    it('should get duplicates from array', () => {
      const findings = [
        createMockFinding('finding-1'),
        createMockFinding('finding-2'),
        createMockFinding('finding-1'), // Duplicate
        createMockFinding('finding-3')
      ];
      
      const duplicates = service.getDuplicates(findings);
      
      expect(duplicates).toHaveLength(1);
      expect(duplicates[0].id).toBe('finding-1');
    });
  });

  describe('Configuration', () => {
    it('should not deduplicate when disabled', () => {
      config.enabled = false;
      service = new DeduplicationService(config);
      
      const finding = createMockFinding('finding-1');
      
      expect(service.isDuplicate(finding)).toBe(false);
      expect(service.isDuplicate(finding)).toBe(false); // Still not duplicate
    });

    it('should create default configuration', () => {
      const defaultConfig = DeduplicationService.createDefaultConfig();
      
      expect(defaultConfig.enabled).toBe(true);
      expect(defaultConfig.strategy).toBe('findingId');
      expect(defaultConfig.cacheSize).toBe(10000);
    });

    it('should create content hash configuration', () => {
      const hashConfig = DeduplicationService.createContentHashConfig(5000);
      
      expect(hashConfig.strategy).toBe('contentHash');
      expect(hashConfig.cacheSize).toBe(5000);
    });

    it('should create time window configuration', () => {
      const windowConfig = DeduplicationService.createTimeWindowConfig(30, 2000);
      
      expect(windowConfig.strategy).toBe('timeWindow');
      expect(windowConfig.timeWindowMinutes).toBe(30);
      expect(windowConfig.cacheSize).toBe(2000);
    });
  });
});
// Helper function to create mock GuardDuty findings
function createMockFinding(id: string): GuardDutyFinding {
  return {
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
            ipAddressV4: '198.51.100.1',
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
  };
}
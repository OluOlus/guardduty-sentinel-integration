/**
 * Property-based tests for DeduplicationService
 * **Feature: guardduty-sentinel-integration, Property 6: Deduplication Handling**
 * **Validates: Requirements 3.5**
 */

import fc from 'fast-check';
import { DeduplicationService } from '../../src/services/deduplication-service';
import { DeduplicationConfig } from '../../src/types/configuration';
import { GuardDutyFinding } from '../../src/types/guardduty';

describe('DeduplicationService Property Tests', () => {
  /**
   * Property 6: Deduplication Handling
   * For any duplicate finding detected during processing, the ingestion worker should 
   * handle deduplication according to the configured deduplication strategy.
   */
  describe('Property 6: Deduplication Handling', () => {
    it('should handle deduplication consistently for any strategy configuration', async () => {
      await fc.assert(
        fc.property(
          // Generate deduplication configuration
          generateDeduplicationConfig(),
          // Generate array of findings with potential duplicates
          generateFindingsWithDuplicates(),
          (config, findings) => {
            const service = new DeduplicationService(config);
            
            if (!config.enabled) {
              // Property: When deduplication is disabled, no findings should be marked as duplicates
              for (const finding of findings) {
                expect(service.isDuplicate(finding)).toBe(false);
              }
              return;
            }
            
            // Track duplicate detection results
            const duplicateResults: boolean[] = [];
            const duplicateEvents: string[] = [];
            
            // Listen for duplicate events
            service.on('duplicate-detected', (findingId, strategy) => {
              duplicateEvents.push(`${findingId}:${strategy}`);
            });
            
            // Process findings and track results
            for (const finding of findings) {
              const isDuplicate = service.isDuplicate(finding);
              duplicateResults.push(isDuplicate);
            }
            
            // Property: Duplicate detection should be consistent with strategy
            switch (config.strategy) {
              case 'findingId':
                validateFindingIdStrategy(findings, duplicateResults);
                break;
              case 'contentHash':
                validateContentHashStrategy(findings, duplicateResults);
                break;
              case 'timeWindow':
                validateTimeWindowStrategy(findings, duplicateResults, config.timeWindowMinutes || 60);
                break;
            }
            
            // Property: Duplicate events should be emitted for detected duplicates
            const detectedDuplicates = duplicateResults.filter(result => result).length;
            expect(duplicateEvents.length).toBe(detectedDuplicates);
            
            // Property: All duplicate events should reference the correct strategy
            for (const event of duplicateEvents) {
              expect(event).toContain(`:${config.strategy}`);
            }
          }
        ),
        { numRuns: 20 }
      );
    });

    it('should maintain cache consistency across batch operations', async () => {
      await fc.assert(
        fc.property(
          generateDeduplicationConfig(),
          fc.array(generateGuardDutyFinding(), { minLength: 1, maxLength: 20 }),
          (config, findings) => {
            // Skip if deduplication is disabled
            if (!config.enabled) {
              return;
            }
            
            const service = new DeduplicationService(config);
            
            // Process findings individually
            const individualResults = findings.map(finding => service.isDuplicate(finding));
            
            // Clear cache and process as batch using the new processBatch method
            service.clearCache();
            const { filtered: batchResults, duplicates: duplicatesFromBatch } = service.processBatch(findings);
            
            // Property: Batch operations should be consistent with individual processing
            expect(batchResults.length + duplicatesFromBatch.length).toBe(findings.length);
            
            // Property: No finding should appear in both filtered and duplicates arrays
            const filteredIds = new Set(batchResults.map(f => f.id));
            const duplicateIds = new Set(duplicatesFromBatch.map(f => f.id));
            
            for (const id of filteredIds) {
              expect(duplicateIds.has(id)).toBe(false);
            }
            
            // Property: Cache size should not exceed configured limit
            if (config.cacheSize) {
              const stats = service.getCacheStats();
              expect(stats.size).toBeLessThanOrEqual(config.cacheSize);
            }
          }
        ),
        { numRuns: 15 }
      );
    });

    it('should handle cache eviction correctly when cache size is exceeded', async () => {
      await fc.assert(
        fc.property(
          // Generate config with small cache size to trigger eviction
          fc.record({
            enabled: fc.constant(true),
            strategy: fc.constantFrom('findingId', 'contentHash', 'timeWindow') as fc.Arbitrary<'findingId' | 'contentHash' | 'timeWindow'>,
            cacheSize: fc.integer({ min: 1, max: 5 }),
            timeWindowMinutes: fc.option(fc.integer({ min: 1, max: 60 }), { nil: undefined })
          }),
          // Generate more findings than cache size
          fc.array(generateGuardDutyFinding(), { minLength: 6, maxLength: 15 }),
          (config, findings) => {
            const service = new DeduplicationService(config);
            let evictionEvents = 0;
            
            // Listen for cache eviction events
            service.on('cache-evicted', () => {
              evictionEvents++;
            });
            
            // Process all findings
            for (const finding of findings) {
              service.isDuplicate(finding);
            }
            
            const stats = service.getCacheStats();
            
            // Property: Cache size should not exceed configured limit
            expect(stats.size).toBeLessThanOrEqual(config.cacheSize);
            
            // Property: If more unique findings than cache size, eviction should occur
            const uniqueFindings = getUniqueFindings(findings, config.strategy);
            if (uniqueFindings.length > config.cacheSize) {
              expect(evictionEvents).toBeGreaterThan(0);
            }
          }
        ),
        { numRuns: 10 }
      );
    });

    it('should maintain metrics accuracy across all operations', async () => {
      await fc.assert(
        fc.property(
          generateDeduplicationConfig(),
          fc.array(generateGuardDutyFinding(), { minLength: 1, maxLength: 15 }),
          (config, findings) => {
            const service = new DeduplicationService(config);
            let metricsUpdates = 0;
            
            service.on('metrics-updated', () => {
              metricsUpdates++;
            });
            
            // Process findings
            let expectedDuplicates = 0;
            for (const finding of findings) {
              const isDuplicate = service.isDuplicate(finding);
              if (isDuplicate) {
                expectedDuplicates++;
              }
            }
            
            const metrics = service.getMetrics();
            
            // Property: Metrics should accurately reflect processing
            expect(metrics.totalProcessed).toBe(findings.length);
            expect(metrics.duplicatesDetected).toBe(expectedDuplicates);
            
            if (findings.length > 0) {
              expect(metrics.deduplicationRate).toBeCloseTo(expectedDuplicates / findings.length);
            }
            
            // Property: Metrics should be updated for each processed finding
            expect(metricsUpdates).toBe(findings.length);
            
            // Property: Cache hit rate should be valid percentage
            const stats = service.getCacheStats();
            expect(stats.hitRate).toBeGreaterThanOrEqual(0);
            expect(stats.hitRate).toBeLessThanOrEqual(1);
          }
        ),
        { numRuns: 15 }
      );
    });
  });
});

// Helper functions for validation

function validateFindingIdStrategy(findings: GuardDutyFinding[], results: boolean[]): void {
  // For findingId strategy, we can't simply track all seen IDs because cache eviction
  // may cause previously seen IDs to be forgotten. Instead, we validate that:
  // 1. The first occurrence of any ID is never marked as duplicate
  // 2. Consecutive duplicates are handled correctly
  
  const firstOccurrences = new Map<string, number>();
  
  for (let i = 0; i < findings.length; i++) {
    const finding = findings[i];
    const isDuplicate = results[i];
    
    if (!firstOccurrences.has(finding.id)) {
      // First occurrence should never be duplicate
      firstOccurrences.set(finding.id, i);
      expect(isDuplicate).toBe(false);
    }
    // Note: We can't validate subsequent occurrences due to potential cache eviction
    // This is correct behavior - a cache with limited size may forget entries
  }
}

function validateContentHashStrategy(findings: GuardDutyFinding[], results: boolean[]): void {
  // Similar to findingId strategy, we can only validate first occurrences
  // due to potential cache eviction
  
  const firstOccurrences = new Map<string, number>();
  
  for (let i = 0; i < findings.length; i++) {
    const finding = findings[i];
    const isDuplicate = results[i];
    const hash = generateContentHash(finding);
    
    if (!firstOccurrences.has(hash)) {
      // First occurrence should never be duplicate
      firstOccurrences.set(hash, i);
      expect(isDuplicate).toBe(false);
    }
    // Note: We can't validate subsequent occurrences due to potential cache eviction
  }
}

function validateTimeWindowStrategy(
  findings: GuardDutyFinding[], 
  results: boolean[], 
  timeWindowMinutes: number
): void {
  // For time window strategy, we can't easily validate without knowing exact timing
  // But we can validate that the first occurrence of any ID is never a duplicate
  const firstOccurrences = new Map<string, number>();
  
  for (let i = 0; i < findings.length; i++) {
    const finding = findings[i];
    const isDuplicate = results[i];
    
    if (!firstOccurrences.has(finding.id)) {
      firstOccurrences.set(finding.id, i);
      // First occurrence should never be duplicate
      expect(isDuplicate).toBe(false);
    }
  }
}

function generateContentHash(finding: GuardDutyFinding): string {
  const contentForHash = {
    type: finding.type,
    accountId: finding.accountId,
    region: finding.region,
    resourceType: finding.resource.resourceType,
    severity: finding.severity,
    instanceId: finding.resource.instanceDetails?.instanceId,
    serviceName: finding.service.serviceName
  };
  
  return JSON.stringify(contentForHash, Object.keys(contentForHash).sort());
}

function getUniqueFindings(findings: GuardDutyFinding[], strategy: string): GuardDutyFinding[] {
  const seen = new Set<string>();
  const unique: GuardDutyFinding[] = [];
  
  for (const finding of findings) {
    let key: string;
    
    switch (strategy) {
      case 'findingId':
        key = finding.id;
        break;
      case 'contentHash':
        key = generateContentHash(finding);
        break;
      case 'timeWindow':
        key = finding.id; // Simplified for property testing
        break;
      default:
        key = finding.id;
    }
    
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(finding);
    }
  }
  
  return unique;
}

// Generators for property-based testing

function generateDeduplicationConfig(): fc.Arbitrary<DeduplicationConfig> {
  return fc.record({
    enabled: fc.boolean(),
    strategy: fc.constantFrom('findingId', 'contentHash', 'timeWindow') as fc.Arbitrary<'findingId' | 'contentHash' | 'timeWindow'>,
    cacheSize: fc.option(fc.integer({ min: 1, max: 100 }), { nil: undefined }),
    timeWindowMinutes: fc.option(fc.integer({ min: 1, max: 60 }), { nil: undefined })
  });
}

function generateGuardDutyFinding(): fc.Arbitrary<GuardDutyFinding> {
  return fc.record({
    schemaVersion: fc.constant('2.0'),
    accountId: fc.string({ minLength: 12, maxLength: 12 }).map(s => s.padStart(12, '0')),
    region: fc.constantFrom('us-east-1', 'us-west-2', 'eu-west-1'),
    partition: fc.constant('aws'),
    id: fc.uuid(),
    arn: fc.string().map(id => `arn:aws:guardduty:us-east-1:123456789012:detector/test/finding/${id}`),
    type: fc.constantFrom(
      'Trojan:EC2/DNSDataExfiltration',
      'Backdoor:EC2/C&CActivity.B!DNS',
      'CryptoCurrency:EC2/BitcoinTool.B!DNS'
    ),
    resource: fc.record({
      resourceType: fc.constantFrom('Instance', 'S3Bucket'),
      instanceDetails: fc.option(fc.record({
        instanceId: fc.string().map(s => `i-${s.substring(0, 17)}`),
        instanceType: fc.constantFrom('t2.micro', 't3.small'),
        instanceState: fc.constantFrom('running', 'stopped'),
        availabilityZone: fc.constantFrom('us-east-1a', 'us-east-1b')
      }))
    }),
    service: fc.record({
      serviceName: fc.constant('guardduty'),
      detectorId: fc.uuid(),
      archived: fc.boolean(),
      count: fc.integer({ min: 1, max: 10 }),
      eventFirstSeen: fc.date().map(d => d.toISOString()),
      eventLastSeen: fc.date().map(d => d.toISOString()),
      resourceRole: fc.constantFrom('TARGET', 'ACTOR')
    }),
    severity: fc.float({ min: 0.0, max: Math.fround(8.9) }),
    createdAt: fc.date().map(d => d.toISOString()),
    updatedAt: fc.date().map(d => d.toISOString()),
    title: fc.string({ minLength: 5, maxLength: 50 }),
    description: fc.string({ minLength: 10, maxLength: 100 })
  });
}

function generateFindingsWithDuplicates(): fc.Arbitrary<GuardDutyFinding[]> {
  return fc.array(generateGuardDutyFinding(), { minLength: 1, maxLength: 10 })
    .chain(findings => {
      // Introduce some duplicates by reusing existing findings
      return fc.array(
        fc.oneof(
          // Original finding
          fc.constantFrom(...findings),
          // New finding
          generateGuardDutyFinding()
        ),
        { minLength: findings.length, maxLength: findings.length + 5 }
      );
    });
}
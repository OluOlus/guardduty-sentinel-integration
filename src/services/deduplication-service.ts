/**
 * Deduplication service for GuardDuty findings
 * Provides configurable deduplication strategies with metrics tracking
 */

import { createHash } from 'crypto';
import { EventEmitter } from 'events';
import { DeduplicationConfig } from '../types/configuration';
import { GuardDutyFinding } from '../types/guardduty';

export interface DeduplicationEvents {
  'duplicate-detected': (findingId: string, strategy: string) => void;
  'cache-evicted': (evictedCount: number) => void;
  'metrics-updated': (metrics: DeduplicationMetrics) => void;
}

export declare interface DeduplicationService {
  on<U extends keyof DeduplicationEvents>(event: U, listener: DeduplicationEvents[U]): this;
  emit<U extends keyof DeduplicationEvents>(
    event: U,
    ...args: Parameters<DeduplicationEvents[U]>
  ): boolean;
}

export interface DeduplicationMetrics {
  totalProcessed: number;
  duplicatesDetected: number;
  deduplicationRate: number;
  cacheSize: number;
  cacheHitRate: number;
  timestamp: Date;
}

interface CacheEntry {
  key: string;
  timestamp: Date;
  findingId: string;
  hash?: string;
}

/**
 * DeduplicationService handles finding deduplication using configurable strategies
 */
export class DeduplicationService extends EventEmitter {
  private readonly config: DeduplicationConfig;
  private readonly cache = new Map<string, CacheEntry>();
  private metrics: DeduplicationMetrics;
  private cacheHits = 0;
  private cacheMisses = 0;
  private cleanupTimer?: NodeJS.Timeout;

  constructor(config: DeduplicationConfig) {
    super();
    this.config = {
      ...config,
      enabled: config.enabled ?? true,
      strategy: config.strategy ?? 'findingId',
      timeWindowMinutes: config.timeWindowMinutes ?? 60,
      cacheSize: config.cacheSize ?? 10000,
    };
    this.metrics = this.initializeMetrics();

    // Start cache cleanup timer if using time window strategy
    if (this.config.strategy === 'timeWindow' && this.config.timeWindowMinutes) {
      this.startCacheCleanup();
    }
  }

  /**
   * Initialize metrics tracking
   */
  private initializeMetrics(): DeduplicationMetrics {
    return {
      totalProcessed: 0,
      duplicatesDetected: 0,
      deduplicationRate: 0,
      cacheSize: 0,
      cacheHitRate: 0,
      timestamp: new Date(),
    };
  }
  /**
   * Check if a finding is a duplicate
   */
  public isDuplicate(finding: GuardDutyFinding): boolean {
    // Always update metrics regardless of enabled state
    this.metrics.totalProcessed++;

    if (!this.config.enabled) {
      this.updateMetrics();
      return false;
    }

    const key = this.generateDeduplicationKey(finding);
    const existing = this.cache.get(key);

    if (existing) {
      this.cacheHits++;

      // Check if duplicate based on strategy
      if (this.isDuplicateByStrategy(finding, existing)) {
        this.metrics.duplicatesDetected++;
        this.updateMetrics();
        this.emit('duplicate-detected', finding.id, this.config.strategy);
        return true;
      }
    } else {
      this.cacheMisses++;
    }

    // Add to cache (this will handle eviction if needed)
    this.addToCache(key, finding);
    this.updateMetrics();

    return false;
  }

  /**
   * Generate deduplication key based on strategy
   */
  private generateDeduplicationKey(finding: GuardDutyFinding): string {
    switch (this.config.strategy) {
      case 'findingId':
        return `finding:${finding.id}`;

      case 'contentHash':
        return `hash:${this.generateContentHash(finding)}`;

      case 'timeWindow':
        // For time window, use finding ID but check time separately
        return `window:${finding.id}`;

      default:
        throw new Error(`Unknown deduplication strategy: ${this.config.strategy}`);
    }
  }

  /**
   * Generate content hash for content-based deduplication
   */
  private generateContentHash(finding: GuardDutyFinding): string {
    // Create hash based on key finding attributes that indicate same threat
    const contentForHash = {
      type: finding.type,
      accountId: finding.accountId,
      region: finding.region,
      resourceType: finding.resource.resourceType,
      severity: finding.severity,
      // Include resource-specific identifiers
      instanceId: finding.resource.instanceDetails?.instanceId,
      s3BucketName: finding.resource.s3BucketDetails?.name,
      // Include key service details
      serviceName: finding.service.serviceName,
      remoteIp: finding.service.action?.networkConnectionAction?.remoteIpDetails?.ipAddressV4,
    };

    const contentString = JSON.stringify(contentForHash, Object.keys(contentForHash).sort());
    return createHash('sha256').update(contentString).digest('hex');
  }

  /**
   * Check if finding is duplicate based on strategy
   */
  private isDuplicateByStrategy(finding: GuardDutyFinding, existing: CacheEntry): boolean {
    switch (this.config.strategy) {
      case 'findingId':
        // Simple ID-based deduplication
        return existing.findingId === finding.id;

      case 'contentHash':
        // Content-based deduplication
        const currentHash = this.generateContentHash(finding);
        return existing.hash === currentHash;

      case 'timeWindow':
        // Time window-based deduplication
        if (!this.config.timeWindowMinutes) {
          return false;
        }

        const now = new Date();
        const windowMs = this.config.timeWindowMinutes * 60 * 1000;
        const timeDiff = now.getTime() - existing.timestamp.getTime();

        return existing.findingId === finding.id && timeDiff < windowMs;

      default:
        return false;
    }
  }
  /**
   * Add finding to cache
   */
  private addToCache(key: string, finding: GuardDutyFinding): void {
    // If key already exists, just update the timestamp (refresh the entry)
    if (this.cache.has(key)) {
      const existing = this.cache.get(key)!;
      existing.timestamp = new Date();
      return;
    }

    // Check cache size limit before adding new entry
    if (this.config.cacheSize && this.cache.size >= this.config.cacheSize) {
      this.evictOldestEntries();
    }

    const entry: CacheEntry = {
      key,
      timestamp: new Date(),
      findingId: finding.id,
      hash: this.config.strategy === 'contentHash' ? this.generateContentHash(finding) : undefined,
    };

    this.cache.set(key, entry);
  }

  /**
   * Evict oldest cache entries when cache is full
   */
  private evictOldestEntries(): void {
    if (!this.config.cacheSize) {
      return;
    }

    // Remove oldest 10% of entries
    const entriesToRemove = Math.max(1, Math.floor(this.config.cacheSize * 0.1));
    const sortedEntries = Array.from(this.cache.entries()).sort(
      ([, a], [, b]) => a.timestamp.getTime() - b.timestamp.getTime()
    );

    for (let i = 0; i < entriesToRemove && i < sortedEntries.length; i++) {
      this.cache.delete(sortedEntries[i][0]);
    }

    this.emit('cache-evicted', entriesToRemove);
  }

  /**
   * Start periodic cache cleanup for time window strategy
   */
  private startCacheCleanup(): void {
    if (!this.config.timeWindowMinutes) {
      return;
    }

    // Clean up every 5 minutes
    const cleanupInterval = 5 * 60 * 1000;

    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredEntries();
    }, cleanupInterval);

    // Ensure timer doesn't keep process alive in tests
    this.cleanupTimer.unref();
  }

  /**
   * Clean up expired entries for time window strategy
   */
  private cleanupExpiredEntries(): void {
    if (this.config.strategy !== 'timeWindow' || !this.config.timeWindowMinutes) {
      return;
    }

    const now = new Date();
    const windowMs = this.config.timeWindowMinutes * 60 * 1000;
    let removedCount = 0;

    for (const [key, entry] of this.cache.entries()) {
      const age = now.getTime() - entry.timestamp.getTime();
      if (age > windowMs) {
        this.cache.delete(key);
        removedCount++;
      }
    }

    if (removedCount > 0) {
      this.emit('cache-evicted', removedCount);
    }
  }

  /**
   * Update metrics and emit events
   */
  private updateMetrics(): void {
    this.metrics.cacheSize = this.cache.size;
    this.metrics.deduplicationRate =
      this.metrics.totalProcessed > 0
        ? this.metrics.duplicatesDetected / this.metrics.totalProcessed
        : 0;

    const totalCacheAccess = this.cacheHits + this.cacheMisses;
    this.metrics.cacheHitRate = totalCacheAccess > 0 ? this.cacheHits / totalCacheAccess : 0;

    this.metrics.timestamp = new Date();

    this.emit('metrics-updated', { ...this.metrics });
  }
  /**
   * Get current deduplication metrics
   */
  public getMetrics(): DeduplicationMetrics {
    return { ...this.metrics };
  }

  /**
   * Get cache statistics
   */
  public getCacheStats(): {
    size: number;
    maxSize: number;
    hitRate: number;
    totalHits: number;
    totalMisses: number;
  } {
    return {
      size: this.cache.size,
      maxSize: this.config.cacheSize || 0,
      hitRate: this.metrics.cacheHitRate,
      totalHits: this.cacheHits,
      totalMisses: this.cacheMisses,
    };
  }

  /**
   * Clear the deduplication cache
   */
  public clearCache(): void {
    this.cache.clear();
    this.cacheHits = 0;
    this.cacheMisses = 0;
    this.metrics = this.initializeMetrics();
  }

  /**
   * Destroy the service and clean up resources
   */
  public destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
    this.clearCache();
    this.removeAllListeners();
  }

  /**
   * Process findings and return both filtered and duplicate arrays in a single pass
   * This avoids cache state issues when calling filterDuplicates and getDuplicates separately
   */
  public processBatch(findings: GuardDutyFinding[]): {
    filtered: GuardDutyFinding[];
    duplicates: GuardDutyFinding[];
  } {
    const filtered: GuardDutyFinding[] = [];
    const duplicates: GuardDutyFinding[] = [];

    if (!this.config.enabled) {
      // Update metrics for processed findings
      this.metrics.totalProcessed += findings.length;
      this.updateMetrics();
      return { filtered: findings, duplicates: [] };
    }

    for (const finding of findings) {
      if (this.isDuplicate(finding)) {
        duplicates.push(finding);
      } else {
        filtered.push(finding);
      }
    }

    return { filtered, duplicates };
  }

  /**
   * Filter out duplicate findings from an array
   */
  public filterDuplicates(findings: GuardDutyFinding[]): GuardDutyFinding[] {
    if (!this.config.enabled) {
      // Still update metrics for processed findings
      this.metrics.totalProcessed += findings.length;
      this.updateMetrics();
      return findings;
    }

    const filtered: GuardDutyFinding[] = [];

    for (const finding of findings) {
      if (!this.isDuplicate(finding)) {
        filtered.push(finding);
      }
    }

    return filtered;
  }

  /**
   * Get duplicate findings from an array
   * Note: This method should be called on a fresh service instance or after clearCache()
   * to avoid cache state interference with filterDuplicates()
   */
  public getDuplicates(findings: GuardDutyFinding[]): GuardDutyFinding[] {
    if (!this.config.enabled) {
      return [];
    }

    const duplicates: GuardDutyFinding[] = [];

    for (const finding of findings) {
      if (this.isDuplicate(finding)) {
        duplicates.push(finding);
      }
    }

    return duplicates;
  }

  /**
   * Create a default deduplication configuration
   */
  public static createDefaultConfig(): DeduplicationConfig {
    return {
      enabled: true,
      strategy: 'findingId',
      timeWindowMinutes: 60,
      cacheSize: 10000,
    };
  }

  /**
   * Create a content-hash based deduplication configuration
   */
  public static createContentHashConfig(cacheSize = 10000): DeduplicationConfig {
    return {
      enabled: true,
      strategy: 'contentHash',
      cacheSize,
    };
  }

  /**
   * Create a time-window based deduplication configuration
   */
  public static createTimeWindowConfig(
    timeWindowMinutes = 60,
    cacheSize = 10000
  ): DeduplicationConfig {
    return {
      enabled: true,
      strategy: 'timeWindow',
      timeWindowMinutes,
      cacheSize,
    };
  }
}

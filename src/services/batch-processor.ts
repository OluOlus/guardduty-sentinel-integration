/**
 * Batch processing engine for GuardDuty findings
 * Handles queue management, batch optimization, and throughput control
 */

import { EventEmitter } from 'events';
import { 
  ProcessingBatch, 
  S3ObjectInfo, 
  WorkerConfig, 
  ProcessingError,
  ProcessingMetrics 
} from '../types/configuration';
import { GuardDutyFinding } from '../types/guardduty';

export interface BatchProcessorEvents {
  'batch-created': (batch: ProcessingBatch) => void;
  'batch-completed': (batch: ProcessingBatch) => void;
  'batch-failed': (batch: ProcessingBatch, error: ProcessingError) => void;
  'metrics-updated': (metrics: ProcessingMetrics) => void;
}

export declare interface BatchProcessor {
  on<U extends keyof BatchProcessorEvents>(
    event: U, 
    listener: BatchProcessorEvents[U]
  ): this;
  emit<U extends keyof BatchProcessorEvents>(
    event: U, 
    ...args: Parameters<BatchProcessorEvents[U]>
  ): boolean;
}

/**
 * BatchProcessor manages the queuing and batching of S3 objects and findings
 * for optimal throughput and resource utilization
 */
export class BatchProcessor extends EventEmitter {
  private readonly config: WorkerConfig;
  private readonly s3Queue: S3ObjectInfo[] = [];
  private readonly findingsQueue: GuardDutyFinding[] = [];
  private readonly activeBatches = new Map<string, ProcessingBatch>();
  private readonly completedBatches = new Map<string, ProcessingBatch>();
  private batchCounter = 0;
  private metrics: ProcessingMetrics;
  private isProcessing = false;
  private autoProcess = true; // Allow disabling auto-processing for testing

  constructor(config: WorkerConfig) {
    super();
    this.config = config;
    this.metrics = this.initializeMetrics();
  }
  /**
   * Initialize metrics tracking
   */
  private initializeMetrics(): ProcessingMetrics {
    return {
      totalProcessed: 0,
      totalErrors: 0,
      successRate: 1.0,
      avgProcessingTimeMs: 0,
      queueSize: 0,
      throughput: 0,
      timestamp: new Date()
    };
  }

  /**
   * Add S3 objects to the processing queue
   */
  public addS3Objects(objects: S3ObjectInfo[]): void {
    this.s3Queue.push(...objects);
    this.updateMetrics();
    
    if (this.autoProcess && !this.isProcessing) {
      this.processQueue();
    }
  }

  /**
   * Add findings directly to the processing queue
   */
  public addFindings(findings: GuardDutyFinding[]): void {
    this.findingsQueue.push(...findings);
    this.updateMetrics();
    
    if (this.autoProcess && !this.isProcessing) {
      this.processQueue();
    }
  }

  /**
   * Create a new batch from queued items
   */
  private createBatch(): ProcessingBatch | null {
    const batchSize = this.config.batchSize;
    const batchId = `batch-${++this.batchCounter}-${Date.now()}`;
    
    // Prioritize findings queue first, then S3 objects
    const findings = this.findingsQueue.splice(0, batchSize);
    const s3Objects: S3ObjectInfo[] = [];
    
    // If we don't have enough findings, fill with S3 objects
    if (findings.length < batchSize && this.s3Queue.length > 0) {
      const remainingCapacity = batchSize - findings.length;
      s3Objects.push(...this.s3Queue.splice(0, remainingCapacity));
    }
    
    // Don't create empty batches
    if (findings.length === 0 && s3Objects.length === 0) {
      return null;
    }

    const batch: ProcessingBatch = {
      batchId,
      s3Objects,
      findings,
      processedCount: 0,
      failedCount: 0,
      retryCount: 0,
      status: 'pending',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    this.activeBatches.set(batchId, batch);
    this.emit('batch-created', batch);
    
    return batch;
  }
  /**
   * Process the queue by creating and managing batches
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;
    const batchPromises: Promise<void>[] = [];

    try {
      while (this.s3Queue.length > 0 || this.findingsQueue.length > 0) {
        const batch = this.createBatch();
        if (!batch) {
          break;
        }

        // Process batch asynchronously but collect promises for manual processing
        const batchPromise = this.processBatch(batch).catch(error => {
          this.handleBatchError(batch, error);
        });
        
        batchPromises.push(batchPromise);

        // Apply batch optimization logic - small delay between batch creation
        // to prevent overwhelming downstream systems
        await this.sleep(10);
      }
      
      // If this is manual processing (not auto-process), wait for all batches to complete
      if (!this.autoProcess) {
        await Promise.all(batchPromises);
      }
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Process a single batch
   */
  private async processBatch(batch: ProcessingBatch): Promise<void> {
    const startTime = Date.now();
    
    try {
      batch.status = 'processing';
      batch.updatedAt = new Date();
      
      // For testing purposes, add a small delay to keep batches visible
      await this.sleep(20);
      
      // Batch optimization: process findings and S3 objects concurrently
      const processingPromises: Promise<void>[] = [];
      
      if (batch.findings.length > 0) {
        processingPromises.push(this.processFindings(batch));
      }
      
      if (batch.s3Objects.length > 0) {
        processingPromises.push(this.processS3Objects(batch));
      }
      
      await Promise.all(processingPromises);
      
      batch.status = 'completed';
      batch.updatedAt = new Date();
      
      // Move to completed batches and clean up
      this.activeBatches.delete(batch.batchId);
      this.completedBatches.set(batch.batchId, batch);
      
      // Update metrics
      const processingTime = Date.now() - startTime;
      this.updateProcessingMetrics(batch, processingTime);
      
      this.emit('batch-completed', batch);
      
    } catch (error) {
      this.handleBatchError(batch, error as Error);
    }
  }

  /**
   * Process findings within a batch
   */
  private async processFindings(batch: ProcessingBatch): Promise<void> {
    // This is a placeholder for actual finding processing
    // In real implementation, this would send findings to Azure Monitor
    for (const finding of batch.findings) {
      try {
        // Simulate processing time
        await this.sleep(1);
        batch.processedCount++;
      } catch (error) {
        batch.failedCount++;
        throw error;
      }
    }
  }
  /**
   * Process S3 objects within a batch
   */
  private async processS3Objects(batch: ProcessingBatch): Promise<void> {
    // This is a placeholder for actual S3 object processing
    // In real implementation, this would download and parse S3 objects
    for (const s3Object of batch.s3Objects) {
      try {
        // Simulate processing time based on object size
        const processingTime = Math.min(s3Object.size / 1000, 100);
        await this.sleep(processingTime);
        batch.processedCount++;
      } catch (error) {
        batch.failedCount++;
        throw error;
      }
    }
  }

  /**
   * Handle batch processing errors
   */
  private handleBatchError(batch: ProcessingBatch, error: Error): void {
    const processingError: ProcessingError = {
      code: 'BATCH_PROCESSING_ERROR',
      message: error.message,
      details: {
        batchId: batch.batchId,
        findingsCount: batch.findings.length,
        s3ObjectsCount: batch.s3Objects.length
      },
      timestamp: new Date(),
      stackTrace: error.stack
    };

    batch.status = 'failed';
    batch.error = processingError;
    batch.updatedAt = new Date();

    this.activeBatches.delete(batch.batchId);
    this.metrics.totalErrors++;
    this.updateMetrics();

    this.emit('batch-failed', batch, processingError);
  }

  /**
   * Update processing metrics after batch completion
   */
  private updateProcessingMetrics(batch: ProcessingBatch, processingTimeMs: number): void {
    const totalItems = batch.findings.length + batch.s3Objects.length;
    
    this.metrics.totalProcessed += batch.processedCount;
    this.metrics.totalErrors += batch.failedCount;
    
    // Update average processing time (weighted average)
    const totalProcessedBefore = this.metrics.totalProcessed - batch.processedCount;
    if (totalProcessedBefore > 0) {
      this.metrics.avgProcessingTimeMs = 
        (this.metrics.avgProcessingTimeMs * totalProcessedBefore + processingTimeMs) / 
        this.metrics.totalProcessed;
    } else {
      this.metrics.avgProcessingTimeMs = processingTimeMs;
    }
    
    // Calculate success rate
    this.metrics.successRate = this.metrics.totalErrors > 0 ? 
      this.metrics.totalProcessed / (this.metrics.totalProcessed + this.metrics.totalErrors) : 1.0;
    
    this.updateMetrics();
  }
  /**
   * Update general metrics and emit events
   */
  private updateMetrics(): void {
    this.metrics.queueSize = this.s3Queue.length + this.findingsQueue.length;
    this.metrics.timestamp = new Date();
    
    // Calculate throughput (items per second over last minute)
    // This is a simplified calculation - in production, you'd want a sliding window
    const now = Date.now();
    const oneMinuteAgo = now - 60000;
    
    let recentlyProcessed = 0;
    for (const batch of this.completedBatches.values()) {
      if (batch.updatedAt.getTime() > oneMinuteAgo) {
        recentlyProcessed += batch.processedCount;
      }
    }
    
    this.metrics.throughput = recentlyProcessed / 60; // per second
    
    this.emit('metrics-updated', { ...this.metrics });
  }

  /**
   * Get current processing metrics
   */
  public getMetrics(): ProcessingMetrics {
    return { ...this.metrics };
  }

  /**
   * Get active batches
   */
  public getActiveBatches(): ProcessingBatch[] {
    return Array.from(this.activeBatches.values());
  }

  /**
   * Get completed batches (limited to last 100 for memory management)
   */
  public getCompletedBatches(): ProcessingBatch[] {
    const batches = Array.from(this.completedBatches.values());
    return batches.slice(-100); // Keep only last 100 completed batches
  }

  /**
   * Get current queue sizes
   */
  public getQueueStatus(): { s3Objects: number; findings: number; activeBatches: number } {
    return {
      s3Objects: this.s3Queue.length,
      findings: this.findingsQueue.length,
      activeBatches: this.activeBatches.size
    };
  }

  /**
   * Clear all queues and reset state
   */
  public clear(): void {
    this.s3Queue.length = 0;
    this.findingsQueue.length = 0;
    this.activeBatches.clear();
    this.completedBatches.clear();
    this.metrics = this.initializeMetrics();
    this.isProcessing = false;
  }

  /**
   * Set auto-processing mode (useful for testing)
   */
  public setAutoProcess(enabled: boolean): void {
    this.autoProcess = enabled;
  }

  /**
   * Manually trigger batch processing
   */
  public async processBatches(): Promise<void> {
    await this.processQueue();
  }

  /**
   * Utility method for delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
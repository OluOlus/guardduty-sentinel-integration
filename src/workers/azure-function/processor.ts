/**
 * GuardDuty processor for Azure Function worker
 * 
 * Handles S3 event processing with batch handling and Azure Monitor ingestion
 */

import { S3Service } from '../../services/s3-service';
import { JSONLProcessor } from '../../services/jsonl-processor';
import { DataTransformer } from '../../services/data-transformer';
import { BatchProcessor } from '../../services/batch-processor';
import { RetryHandler } from '../../services/retry-handler';
import { DeduplicationService } from '../../services/deduplication-service';
import { AzureMonitorClient } from '../../services/azure-monitor-client';
import { StructuredLogger } from '../../services/structured-logger';
import { HealthCheckSystem } from '../../services/health-check';
import { MetricsCollector } from '../../services/metrics-collector';

import { AzureFunctionConfig } from './config';
import { GuardDutyFinding } from '../../types/guardduty';
import { S3ObjectInfo, ProcessingBatch, HealthCheckStatus } from '../../types/configuration';
import { AzureMonitorIngestionRequest } from '../../types/azure';

export interface ProcessingResult {
  processedBatches: number;
  totalFindings: number;
  errors: string[];
  duration: number;
}

export class GuardDutyProcessor {
  private s3Service: S3Service;
  private jsonlProcessor: JSONLProcessor;
  private dataTransformer: DataTransformer;
  private batchProcessor: BatchProcessor;
  private retryHandler: RetryHandler;
  private deduplicationService?: DeduplicationService;
  private azureClient: AzureMonitorClient;
  private metricsCollector: MetricsCollector;
  private initialized = false;

  constructor(
    private config: AzureFunctionConfig,
    private logger: StructuredLogger,
    private healthCheck: HealthCheckSystem
  ) {
    // Initialize services
    this.s3Service = new S3Service({
      region: config.worker.aws.region,
      accessKeyId: config.worker.aws.accessKeyId,
      secretAccessKey: config.worker.aws.secretAccessKey,
      sessionToken: config.worker.aws.sessionToken,
      kmsKeyId: config.worker.aws.kmsKeyArn
    });

    this.jsonlProcessor = new JSONLProcessor();
    
    this.dataTransformer = new DataTransformer({
      enableNormalization: config.worker.enableNormalization,
      includeRawJson: true
    });

    this.batchProcessor = new BatchProcessor(config.worker);

    this.retryHandler = new RetryHandler({
      maxRetries: config.worker.maxRetries,
      initialBackoffMs: config.worker.retryBackoffMs,
      maxBackoffMs: 30000,
      backoffMultiplier: 2,
      enableJitter: true,
      retryableErrors: ['NETWORK_ERROR', 'TIMEOUT', 'RATE_LIMITED', 'TEMPORARY_FAILURE']
    });

    if (config.worker.deduplication?.enabled) {
      this.deduplicationService = new DeduplicationService(config.worker.deduplication);
    } else {
      // Initialize with disabled deduplication
      this.deduplicationService = new DeduplicationService({
        enabled: false,
        strategy: 'findingId'
      });
    }

    this.azureClient = new AzureMonitorClient({
      azureConfig: config.worker.azure,
      dcrConfig: config.worker.dcr,
      timeoutMs: 30000,
      enableRetry: true
    });

    const monitoringConfig = {
      enableMetrics: config.worker.monitoring?.enableMetrics ?? true,
      enableDetailedLogging: false,
      metricsBackend: config.worker.monitoring?.metricsBackend
    };

    this.metricsCollector = new MetricsCollector(monitoringConfig);

    // Set up event handlers
    this.setupEventHandlers();
  }

  /**
   * Initialize the processor and validate connections
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      this.logger.info('Initializing GuardDuty processor');

      // Test S3 connectivity
      const s3Access = await this.s3Service.testBucketAccess(this.config.worker.aws.s3BucketName);
      if (!s3Access) {
        throw new Error(`Cannot access S3 bucket: ${this.config.worker.aws.s3BucketName}`);
      }

      // Test Azure Monitor connectivity
      const azureConnected = await this.azureClient.testConnection();
      if (!azureConnected) {
        throw new Error('Cannot connect to Azure Monitor');
      }

      // Initialize metrics collection
      await this.metricsCollector.initialize();

      this.initialized = true;
      this.logger.info('GuardDuty processor initialized successfully');

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Failed to initialize GuardDuty processor', { error: errorMessage });
      throw error;
    }
  }

  /**
   * Process S3 objects from the configured bucket
   */
  async processS3Objects(): Promise<ProcessingResult> {
    const startTime = Date.now();
    const errors: string[] = [];
    let processedBatches = 0;
    let totalFindings = 0;

    try {
      this.logger.info('Starting S3 object processing', {
        bucket: this.config.worker.aws.s3BucketName,
        prefix: this.config.worker.aws.s3BucketPrefix
      });

      // List S3 objects
      const s3Objects = await this.s3Service.listObjects(
        this.config.worker.aws.s3BucketName,
        this.config.worker.aws.s3BucketPrefix,
        100 // Limit to prevent overwhelming the function
      );

      if (s3Objects.length === 0) {
        this.logger.info('No S3 objects found to process');
        return {
          processedBatches: 0,
          totalFindings: 0,
          errors: [],
          duration: Date.now() - startTime
        };
      }

      this.logger.info(`Found ${s3Objects.length} S3 objects to process`);

      // Convert to S3ObjectInfo format
      const s3ObjectInfos: S3ObjectInfo[] = s3Objects.map(obj => ({
        bucket: obj.bucket,
        key: obj.key,
        size: obj.size,
        lastModified: obj.lastModified,
        etag: obj.etag,
        kmsKeyId: this.config.worker.aws.kmsKeyArn
      }));

      // Process objects in batches
      const result = await this.processS3ObjectBatch(s3ObjectInfos);
      processedBatches = result.processedBatches;
      totalFindings = result.totalFindings;
      errors.push(...result.errors);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('S3 object processing failed', { error: errorMessage });
      errors.push(errorMessage);
    }

    const duration = Date.now() - startTime;
    
    this.logger.info('S3 object processing completed', {
      processedBatches,
      totalFindings,
      errors: errors.length,
      duration
    });

    return {
      processedBatches,
      totalFindings,
      errors,
      duration
    };
  }

  /**
   * Process specific S3 objects
   */
  async processSpecificS3Objects(s3Objects: S3ObjectInfo[]): Promise<ProcessingResult> {
    const startTime = Date.now();
    
    this.logger.info(`Processing ${s3Objects.length} specific S3 objects`);
    
    const result = await this.processS3ObjectBatch(s3Objects);
    
    const duration = Date.now() - startTime;
    
    this.logger.info('Specific S3 object processing completed', {
      processedBatches: result.processedBatches,
      totalFindings: result.totalFindings,
      errors: result.errors.length,
      duration
    });

    return {
      ...result,
      duration
    };
  }

  /**
   * Process findings directly
   */
  async processFindings(findings: GuardDutyFinding[]): Promise<ProcessingResult> {
    const startTime = Date.now();
    const errors: string[] = [];
    
    try {
      this.logger.info(`Processing ${findings.length} findings directly`);

      // Add findings to batch processor
      this.batchProcessor.addFindings(findings);
      
      // Process batches
      await this.batchProcessor.processBatches();
      
      const metrics = this.batchProcessor.getMetrics();
      
      return {
        processedBatches: 1, // Simplified for direct processing
        totalFindings: metrics.totalProcessed,
        errors,
        duration: Date.now() - startTime
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Direct findings processing failed', { error: errorMessage });
      errors.push(errorMessage);
      
      return {
        processedBatches: 0,
        totalFindings: 0,
        errors,
        duration: Date.now() - startTime
      };
    }
  }

  /**
   * Get health status of the processor
   */
  async getHealthStatus(): Promise<HealthCheckStatus> {
    const components: ComponentHealth[] = [];
    const now = new Date();

    // Check S3 connectivity
    try {
      const s3Healthy = await this.s3Service.testBucketAccess(this.config.worker.aws.s3BucketName);
      components.push({
        name: 'S3Service',
        status: s3Healthy ? 'healthy' : 'unhealthy',
        message: s3Healthy ? 'S3 bucket accessible' : 'S3 bucket not accessible',
        lastCheck: now
      });
    } catch (error) {
      components.push({
        name: 'S3Service',
        status: 'unhealthy',
        message: error instanceof Error ? error.message : 'S3 check failed',
        lastCheck: now
      });
    }

    // Check Azure Monitor connectivity
    try {
      const azureHealthy = await this.azureClient.testConnection();
      components.push({
        name: 'AzureMonitor',
        status: azureHealthy ? 'healthy' : 'unhealthy',
        message: azureHealthy ? 'Azure Monitor accessible' : 'Azure Monitor not accessible',
        lastCheck: now
      });
    } catch (error) {
      components.push({
        name: 'AzureMonitor',
        status: 'unhealthy',
        message: error instanceof Error ? error.message : 'Azure Monitor check failed',
        lastCheck: now
      });
    }

    // Check batch processor status
    const queueStatus = this.batchProcessor.getQueueStatus();
    const queueHealthy = queueStatus.activeBatches < 10; // Arbitrary threshold
    components.push({
      name: 'BatchProcessor',
      status: queueHealthy ? 'healthy' : 'degraded',
      message: `Active batches: ${queueStatus.activeBatches}, Queue size: ${queueStatus.s3Objects + queueStatus.findings}`,
      lastCheck: now
    });

    // Determine overall status
    const hasUnhealthy = components.some(c => c.status === 'unhealthy');
    const hasDegraded = components.some(c => c.status === 'degraded');
    
    const overallStatus = hasUnhealthy ? 'unhealthy' : 
                         hasDegraded ? 'degraded' : 'healthy';

    return {
      status: overallStatus,
      timestamp: now,
      components,
      uptime: process.uptime(),
      version: '1.0.0'
    };
  }

  /**
   * Process a batch of S3 objects
   */
  private async processS3ObjectBatch(s3Objects: S3ObjectInfo[]): Promise<ProcessingResult> {
    const startTime = Date.now();
    const errors: string[] = [];
    let processedBatches = 0;
    let totalFindings = 0;

    try {
      // Process each S3 object
      for (const s3Object of s3Objects) {
        try {
          const findings = await this.processS3Object(s3Object);
          totalFindings += findings.length;
          
          if (findings.length > 0) {
            // Add findings to batch processor
            this.batchProcessor.addFindings(findings);
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          this.logger.error('Failed to process S3 object', {
            bucket: s3Object.bucket,
            key: s3Object.key,
            error: errorMessage
          });
          errors.push(`${s3Object.key}: ${errorMessage}`);
        }
      }

      // Process all batches
      await this.batchProcessor.processBatches();
      
      const completedBatches = this.batchProcessor.getCompletedBatches();
      processedBatches = completedBatches.length;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      errors.push(errorMessage);
    }

    return {
      processedBatches,
      totalFindings,
      errors,
      duration: Date.now() - startTime
    };
  }

  /**
   * Process a single S3 object
   */
  private async processS3Object(s3Object: S3ObjectInfo): Promise<GuardDutyFinding[]> {
    this.logger.debug('Processing S3 object', {
      bucket: s3Object.bucket,
      key: s3Object.key,
      size: s3Object.size
    });

    // Get object from S3
    const s3Result = await this.s3Service.getAndDecryptObject(
      s3Object.bucket,
      s3Object.key,
      s3Object.kmsKeyId
    );

    // Process JSONL content
    const findings = await this.jsonlProcessor.processStream(s3Result.body);
    
    this.logger.debug('Extracted findings from S3 object', {
      bucket: s3Object.bucket,
      key: s3Object.key,
      findingsCount: findings.length
    });

    return findings;
  }

  /**
   * Set up event handlers for batch processing
   */
  private setupEventHandlers(): void {
    this.batchProcessor.on('batch-completed', async (batch: ProcessingBatch) => {
      try {
        await this.processBatchForAzure(batch);
        this.metricsCollector.incrementCounter('batches_completed');
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        this.logger.error('Failed to process batch for Azure', {
          batchId: batch.batchId,
          error: errorMessage
        });
        this.metricsCollector.incrementCounter('batches_failed');
      }
    });

    this.batchProcessor.on('batch-failed', (batch: ProcessingBatch, error) => {
      this.logger.error('Batch processing failed', {
        batchId: batch.batchId,
        error: error.message
      });
      this.metricsCollector.incrementCounter('batches_failed');
    });
  }

  /**
   * Process a completed batch for Azure ingestion
   */
  private async processBatchForAzure(batch: ProcessingBatch): Promise<void> {
    if (batch.findings.length === 0) {
      return;
    }

    const findings = batch.findings as GuardDutyFinding[];
    
    // Apply deduplication if enabled
    let processedFindings = findings;
    if (this.deduplicationService) {
      processedFindings = await this.deduplicationService.deduplicateFindings(findings);
    }

    if (processedFindings.length === 0) {
      this.logger.debug('All findings were duplicates, skipping batch', {
        batchId: batch.batchId
      });
      return;
    }

    // Transform findings
    const transformedResult = await this.dataTransformer.transformFindings(processedFindings);
    const transformedFindings = transformedResult.data;

    if (transformedResult.errors.length > 0) {
      this.logger.warn('Some findings failed transformation', {
        batchId: batch.batchId,
        failedCount: transformedResult.failedCount,
        total: processedFindings.length
      });
    }

    // Prepare Azure ingestion request
    const ingestionRequest: AzureMonitorIngestionRequest = {
      data: transformedFindings,
      streamName: this.config.worker.dcr.streamName,
      timestamp: new Date()
    };

    // Ingest to Azure with retry logic
    await this.retryHandler.executeWithRetry(
      async () => {
        const result = await this.azureClient.ingestData(ingestionRequest);
        
        if (result.status === 'failed') {
          const errorMessages = result.errors?.map((entry) => entry.message) ?? ['Unknown error'];
          throw new Error(`Azure ingestion failed: ${errorMessages.join(', ')}`);
        }
        
        this.logger.info('Successfully ingested batch to Azure', {
          batchId: batch.batchId,
          findingsCount: processedFindings.length,
          acceptedRecords: result.acceptedRecords
        });
        
        this.metricsCollector.incrementCounter('findings_ingested', result.acceptedRecords);
      },
      `batch-${batch.batchId}`
    );
  }
}

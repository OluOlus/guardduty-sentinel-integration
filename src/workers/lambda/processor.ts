/**
 * GuardDuty processor for AWS Lambda worker
 * 
 * Handles S3 object processing and HTTP posting to Azure endpoints
 * with cross-cloud authentication and network configuration
 */

import { S3Service } from '../../services/s3-service';
import { JSONLProcessor } from '../../services/jsonl-processor';
import { DataTransformer } from '../../services/data-transformer';
import { RetryHandler } from '../../services/retry-handler';
import { DeduplicationService } from '../../services/deduplication-service';
import { StructuredLogger } from '../../services/structured-logger';
import { MetricsCollector } from '../../services/metrics-collector';

import { LambdaConfig } from './config';
import { AzureHttpClient } from './azure-http-client';
import { GuardDutyFinding } from '../../types/guardduty';
import { S3ObjectInfo, HealthCheckStatus, ComponentHealth } from '../../types/configuration';

export interface ProcessingResult {
  processedBatches: number;
  totalFindings: number;
  errors: string[];
  duration: number;
}

export interface S3ObjectResult {
  findingsCount: number;
}

export class GuardDutyProcessor {
  private s3Service: S3Service;
  private jsonlProcessor: JSONLProcessor;
  private dataTransformer: DataTransformer;
  private retryHandler: RetryHandler;
  private deduplicationService?: DeduplicationService;
  private azureHttpClient: AzureHttpClient;
  private initialized = false;

  constructor(
    private config: LambdaConfig,
    private logger: StructuredLogger,
    private metricsCollector: MetricsCollector
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
    }

    this.azureHttpClient = new AzureHttpClient({
      azureConfig: config.worker.azure,
      dcrConfig: config.worker.dcr,
      timeoutMs: config.timeoutMs,
      enableRetry: true
    });
  }

  /**
   * Initialize the processor and validate connections
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      this.logger.info('Initializing Lambda GuardDuty processor');

      // Test S3 connectivity
      const s3Access = await this.s3Service.testBucketAccess(this.config.worker.aws.s3BucketName);
      if (!s3Access) {
        throw new Error(`Cannot access S3 bucket: ${this.config.worker.aws.s3BucketName}`);
      }

      // Test Azure HTTP connectivity
      const azureConnected = await this.azureHttpClient.testConnection();
      if (!azureConnected) {
        throw new Error('Cannot connect to Azure HTTP endpoint');
      }

      // Initialize metrics collection
      await this.metricsCollector.initialize();

      this.initialized = true;
      this.logger.info('Lambda GuardDuty processor initialized successfully');

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Failed to initialize Lambda GuardDuty processor', { error: errorMessage });
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
        50 // Limit for Lambda processing
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

      // Process objects
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

      // Process findings in batches
      const batchSize = this.config.worker.batchSize;
      let processedBatches = 0;
      let totalProcessed = 0;

      for (let i = 0; i < findings.length; i += batchSize) {
        const batch = findings.slice(i, i + batchSize);
        
        try {
          await this.processFindingsBatch(batch);
          processedBatches++;
          totalProcessed += batch.length;
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          errors.push(`Batch ${processedBatches + 1}: ${errorMessage}`);
        }
      }
      
      return {
        processedBatches,
        totalFindings: totalProcessed,
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
   * Process a single S3 object
   */
  async processS3Object(s3Object: S3ObjectInfo): Promise<S3ObjectResult> {
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

    if (findings.length > 0) {
      // Process findings in batches
      await this.processFindingsBatch(findings);
    }

    return {
      findingsCount: findings.length
    };
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

    // Check Azure HTTP connectivity
    try {
      const azureHealthy = await this.azureHttpClient.testConnection();
      components.push({
        name: 'AzureHttpClient',
        status: azureHealthy ? 'healthy' : 'unhealthy',
        message: azureHealthy ? 'Azure HTTP endpoint accessible' : 'Azure HTTP endpoint not accessible',
        lastCheck: now
      });
    } catch (error) {
      components.push({
        name: 'AzureHttpClient',
        status: 'unhealthy',
        message: error instanceof Error ? error.message : 'Azure HTTP check failed',
        lastCheck: now
      });
    }

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
    const errors: string[] = [];
    let processedBatches = 0;
    let totalFindings = 0;

    try {
      // Process each S3 object
      for (const s3Object of s3Objects) {
        try {
          const result = await this.processS3Object(s3Object);
          totalFindings += result.findingsCount;
          
          if (result.findingsCount > 0) {
            processedBatches++;
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

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      errors.push(errorMessage);
    }

    return {
      processedBatches,
      totalFindings,
      errors
    };
  }

  /**
   * Process a batch of findings
   */
  private async processFindingsBatch(findings: GuardDutyFinding[]): Promise<void> {
    if (findings.length === 0) {
      return;
    }

    // Apply deduplication if enabled
    let processedFindings = findings;
    if (this.deduplicationService) {
      processedFindings = await this.deduplicationService.deduplicateFindings(findings);
    }

    if (processedFindings.length === 0) {
      this.logger.debug('All findings were duplicates, skipping batch');
      return;
    }

    // Transform findings
    const transformedFindings = this.dataTransformer.transformFindings(processedFindings);

    // Send to Azure with retry logic
    await this.retryHandler.executeWithRetry(
      async () => {
        const result = await this.azureHttpClient.ingestData({
          data: transformedFindings,
          streamName: this.config.worker.dcr.streamName,
          timestamp: new Date()
        });
        
        if (result.status === 'failed') {
          throw new Error(`Azure ingestion failed: ${result.errors.map(e => e.message).join(', ')}`);
        }
        
        this.logger.info('Successfully ingested batch to Azure', {
          findingsCount: processedFindings.length,
          acceptedRecords: result.acceptedRecords
        });
        
        this.metricsCollector.incrementCounter('findings_ingested', result.acceptedRecords);
      },
      `findings-batch-${Date.now()}`
    );
  }
}
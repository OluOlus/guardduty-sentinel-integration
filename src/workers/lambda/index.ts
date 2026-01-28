/**
 * AWS Lambda worker for GuardDuty to Sentinel integration
 * 
 * This Lambda function processes GuardDuty findings from S3 events and posts
 * them to Azure HTTP endpoints using cross-cloud authentication.
 * 
 * Requirements: 3.1, 4.1
 */

import { S3Event, S3EventRecord, Context, Callback } from 'aws-lambda';
import { GuardDutyProcessor } from './processor';
import { LambdaConfig, createConfigFromEnvironment } from './config';
import { StructuredLogger } from '../../services/structured-logger';
import { MetricsCollector } from '../../services/metrics-collector';

// Global instances for Lambda container reuse
let processor: GuardDutyProcessor | null = null;
let logger: StructuredLogger | null = null;
let metricsCollector: MetricsCollector | null = null;

/**
 * Initialize the processor and dependencies
 */
async function initializeProcessor(): Promise<void> {
  if (processor) {
    return; // Already initialized
  }

  try {
    const config = createConfigFromEnvironment();
    const monitoringConfig = {
      enableMetrics: config.worker.monitoring?.enableMetrics ?? true,
      enableDetailedLogging: config.logLevel === 'debug',
      healthCheckPort: config.worker.monitoring?.healthCheckPort,
      metricsBackend: config.worker.monitoring?.metricsBackend
    };

    logger = new StructuredLogger('lambda-worker', monitoringConfig);

    metricsCollector = new MetricsCollector(monitoringConfig);

    processor = new GuardDutyProcessor(config, logger, metricsCollector);
    await processor.initialize();

    logger.info('Lambda worker initialized successfully', {
      batchSize: config.worker.batchSize,
      enableNormalization: config.worker.enableNormalization,
      azureEndpoint: config.worker.azureEndpoint
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Failed to initialize Lambda worker:', errorMessage);
    throw error;
  }
}

/**
 * Main Lambda handler for S3 events
 */
export async function handler(
  event: S3Event,
  context: Context,
  callback: Callback
): Promise<void> {
  const startTime = Date.now();
  
  try {
    await initializeProcessor();
    
    if (!processor || !logger || !metricsCollector) {
      throw new Error('Processor not initialized');
    }

    logger.info('Lambda invoked', {
      requestId: context.awsRequestId,
      functionName: context.functionName,
      recordCount: event.Records.length,
      remainingTime: context.getRemainingTimeInMillis()
    });

    // Process S3 event records
    const results = await processS3Event(event, context);
    
    const duration = Date.now() - startTime;
    
    logger.info('Lambda execution completed', {
      requestId: context.awsRequestId,
      processedRecords: results.processedRecords,
      totalFindings: results.totalFindings,
      errors: results.errors.length,
      duration,
      remainingTime: context.getRemainingTimeInMillis()
    });

    // Emit metrics
    metricsCollector.incrementCounter('lambda_invocations');
    metricsCollector.incrementCounter('s3_records_processed', results.processedRecords);
    metricsCollector.incrementCounter('findings_processed', results.totalFindings);
    metricsCollector.recordGauge('execution_duration_ms', duration);

    if (results.errors.length > 0) {
      metricsCollector.incrementCounter('lambda_errors', results.errors.length);
      
      // Log errors but don't fail the entire Lambda
      logger.error('Some records failed processing', {
        requestId: context.awsRequestId,
        errors: results.errors
      });
    }

    callback(null, {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        processedRecords: results.processedRecords,
        totalFindings: results.totalFindings,
        errors: results.errors.length,
        duration
      })
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const duration = Date.now() - startTime;
    
    logger?.error('Lambda execution failed', {
      requestId: context.awsRequestId,
      error: errorMessage,
      duration,
      remainingTime: context.getRemainingTimeInMillis()
    });

    metricsCollector?.incrementCounter('lambda_failures');
    
    callback(error);
  }
}

/**
 * Process S3 event records
 */
async function processS3Event(event: S3Event, context: Context): Promise<{
  processedRecords: number;
  totalFindings: number;
  errors: string[];
}> {
  if (!processor || !logger) {
    throw new Error('Processor not initialized');
  }

  const errors: string[] = [];
  let processedRecords = 0;
  let totalFindings = 0;

  // Process each S3 record
  for (const record of event.Records) {
    try {
      // Check remaining time to avoid timeout
      if (context.getRemainingTimeInMillis() < 30000) { // 30 seconds buffer
        logger.warn('Approaching Lambda timeout, stopping processing', {
          requestId: context.awsRequestId,
          remainingTime: context.getRemainingTimeInMillis(),
          processedRecords,
          totalRecords: event.Records.length
        });
        break;
      }

      const result = await processS3Record(record, context);
      processedRecords++;
      totalFindings += result.findingsCount;
      
      logger.debug('S3 record processed successfully', {
        bucket: record.s3.bucket.name,
        key: record.s3.object.key,
        findingsCount: result.findingsCount
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorDetail = `${record.s3.bucket.name}/${record.s3.object.key}: ${errorMessage}`;
      
      logger.error('Failed to process S3 record', {
        bucket: record.s3.bucket.name,
        key: record.s3.object.key,
        error: errorMessage
      });
      
      errors.push(errorDetail);
    }
  }

  return {
    processedRecords,
    totalFindings,
    errors
  };
}

/**
 * Process a single S3 record
 */
async function processS3Record(record: S3EventRecord, context: Context): Promise<{
  findingsCount: number;
}> {
  if (!processor) {
    throw new Error('Processor not initialized');
  }

  // Validate S3 event type
  if (!record.eventName.startsWith('ObjectCreated:')) {
    throw new Error(`Unsupported S3 event type: ${record.eventName}`);
  }

  // Extract S3 object information
  const bucket = decodeURIComponent(record.s3.bucket.name);
  const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));
  const size = record.s3.object.size;

  // Validate object key format (should be GuardDuty JSONL files)
  if (!key.includes('GuardDuty') || !key.endsWith('.jsonl.gz')) {
    throw new Error(`Invalid GuardDuty object format: ${key}`);
  }

  // Process the S3 object
  const result = await processor.processS3Object({
    bucket,
    key,
    size,
    lastModified: new Date(), // S3 event doesn't provide this, use current time
    etag: record.s3.object.eTag || '',
    kmsKeyId: undefined // Will be determined from configuration
  });

  return {
    findingsCount: result.findingsCount
  };
}

/**
 * Health check handler (for ALB health checks or manual testing)
 */
export async function healthHandler(
  event: any,
  context: Context,
  callback: Callback
): Promise<void> {
  try {
    await initializeProcessor();
    
    if (!processor) {
      throw new Error('Processor not initialized');
    }

    const health = await processor.getHealthStatus();
    
    const statusCode = health.status === 'healthy' ? 200 : 
                      health.status === 'degraded' ? 200 : 503;

    callback(null, {
      statusCode,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(health)
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    callback(null, {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        status: 'unhealthy',
        message: errorMessage,
        timestamp: new Date().toISOString()
      })
    });
  }
}

/**
 * Manual processing handler (for testing or manual triggers)
 */
export async function manualHandler(
  event: any,
  context: Context,
  callback: Callback
): Promise<void> {
  const startTime = Date.now();
  
  try {
    await initializeProcessor();
    
    if (!processor || !logger) {
      throw new Error('Processor not initialized');
    }

    logger.info('Manual processing invoked', {
      requestId: context.awsRequestId,
      event: event
    });

    let result;
    
    if (event.s3Objects && Array.isArray(event.s3Objects)) {
      // Process specific S3 objects
      result = await processor.processSpecificS3Objects(event.s3Objects);
    } else if (event.findings && Array.isArray(event.findings)) {
      // Process findings directly
      result = await processor.processFindings(event.findings);
    } else {
      // Process all available S3 objects
      result = await processor.processS3Objects();
    }

    const duration = Date.now() - startTime;
    
    callback(null, {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        success: true,
        result,
        duration,
        requestId: context.awsRequestId
      })
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const duration = Date.now() - startTime;
    
    logger?.error('Manual processing failed', {
      requestId: context.awsRequestId,
      error: errorMessage,
      duration
    });

    callback(null, {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        success: false,
        error: errorMessage,
        duration,
        requestId: context.awsRequestId
      })
    });
  }
}

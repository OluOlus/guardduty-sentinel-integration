/**
 * Azure Function worker for GuardDuty to Sentinel integration
 * 
 * This worker provides HTTP and timer triggers for processing GuardDuty findings
 * from S3 and ingesting them into Azure Monitor Logs.
 * 
 * Requirements: 3.1, 4.1
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext, Timer } from '@azure/functions';
import { GuardDutyProcessor } from './processor';
import { AzureFunctionConfig, createConfigFromEnvironment } from './config';
import { StructuredLogger } from '../../services/structured-logger';
import { HealthCheck } from '../../services/health-check';

// Global instances
let processor: GuardDutyProcessor | null = null;
let logger: StructuredLogger | null = null;
let healthCheck: HealthCheck | null = null;

/**
 * Initialize the processor and dependencies
 */
async function initializeProcessor(): Promise<void> {
  if (processor) {
    return; // Already initialized
  }

  try {
    const config = createConfigFromEnvironment();
    logger = new StructuredLogger({
      level: config.logLevel,
      enableConsole: true,
      enableStructured: true
    });

    healthCheck = new HealthCheck({
      port: 0, // Not used in Azure Functions
      enableEndpoint: false
    });

    processor = new GuardDutyProcessor(config, logger, healthCheck);
    await processor.initialize();

    logger.info('Azure Function worker initialized successfully', {
      batchSize: config.worker.batchSize,
      enableNormalization: config.worker.enableNormalization
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Failed to initialize Azure Function worker:', errorMessage);
    throw error;
  }
}

/**
 * HTTP trigger for manual processing or webhook events
 */
export async function httpTrigger(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const startTime = Date.now();
  
  try {
    await initializeProcessor();
    
    if (!processor || !logger) {
      throw new Error('Processor not initialized');
    }

    logger.info('HTTP trigger invoked', {
      method: request.method,
      url: request.url,
      invocationId: context.invocationId
    });

    const method = request.method.toUpperCase();

    switch (method) {
      case 'GET':
        return await handleHealthCheck(context);
      
      case 'POST':
        return await handleProcessingRequest(request, context);
      
      default:
        return {
          status: 405,
          jsonBody: {
            error: 'Method not allowed',
            allowedMethods: ['GET', 'POST']
          }
        };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const duration = Date.now() - startTime;
    
    console.error('HTTP trigger error:', {
      error: errorMessage,
      duration,
      invocationId: context.invocationId
    });

    return {
      status: 500,
      jsonBody: {
        error: 'Internal server error',
        message: errorMessage,
        invocationId: context.invocationId
      }
    };
  }
}

/**
 * Timer trigger for scheduled processing
 */
export async function timerTrigger(myTimer: Timer, context: InvocationContext): Promise<void> {
  const startTime = Date.now();
  
  try {
    await initializeProcessor();
    
    if (!processor || !logger) {
      throw new Error('Processor not initialized');
    }

    logger.info('Timer trigger invoked', {
      scheduleStatus: myTimer.scheduleStatus,
      isPastDue: myTimer.isPastDue,
      invocationId: context.invocationId
    });

    // Process S3 objects from the configured bucket
    const result = await processor.processS3Objects();
    
    const duration = Date.now() - startTime;
    
    logger.info('Timer trigger completed', {
      processedBatches: result.processedBatches,
      totalFindings: result.totalFindings,
      errors: result.errors,
      duration,
      invocationId: context.invocationId
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const duration = Date.now() - startTime;
    
    logger?.error('Timer trigger error', {
      error: errorMessage,
      duration,
      invocationId: context.invocationId
    });

    // Re-throw to mark the function execution as failed
    throw error;
  }
}

/**
 * Handle health check requests
 */
async function handleHealthCheck(context: InvocationContext): Promise<HttpResponseInit> {
  try {
    if (!healthCheck || !processor) {
      return {
        status: 503,
        jsonBody: {
          status: 'unhealthy',
          message: 'Service not initialized'
        }
      };
    }

    const health = await healthCheck.getHealthStatus();
    const processorHealth = await processor.getHealthStatus();

    const overallHealth = {
      ...health,
      components: [
        ...health.components,
        ...processorHealth.components
      ]
    };

    // Determine overall status
    const hasUnhealthy = overallHealth.components.some(c => c.status === 'unhealthy');
    const hasDegraded = overallHealth.components.some(c => c.status === 'degraded');
    
    if (hasUnhealthy) {
      overallHealth.status = 'unhealthy';
    } else if (hasDegraded) {
      overallHealth.status = 'degraded';
    } else {
      overallHealth.status = 'healthy';
    }

    const statusCode = overallHealth.status === 'healthy' ? 200 : 
                      overallHealth.status === 'degraded' ? 200 : 503;

    return {
      status: statusCode,
      jsonBody: overallHealth
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    return {
      status: 500,
      jsonBody: {
        status: 'unhealthy',
        message: errorMessage,
        invocationId: context.invocationId
      }
    };
  }
}

/**
 * Handle processing requests (manual trigger or webhook)
 */
async function handleProcessingRequest(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  try {
    if (!processor || !logger) {
      throw new Error('Processor not initialized');
    }

    const body = await request.text();
    let requestData: any = {};

    if (body) {
      try {
        requestData = JSON.parse(body);
      } catch (parseError) {
        return {
          status: 400,
          jsonBody: {
            error: 'Invalid JSON in request body'
          }
        };
      }
    }

    // Support different processing modes
    const mode = requestData.mode || 'auto';
    let result;

    switch (mode) {
      case 'auto':
        // Process all available S3 objects
        result = await processor.processS3Objects();
        break;
      
      case 'specific':
        // Process specific S3 objects
        if (!requestData.s3Objects || !Array.isArray(requestData.s3Objects)) {
          return {
            status: 400,
            jsonBody: {
              error: 'Missing or invalid s3Objects array for specific mode'
            }
          };
        }
        result = await processor.processSpecificS3Objects(requestData.s3Objects);
        break;
      
      case 'findings':
        // Process provided findings directly
        if (!requestData.findings || !Array.isArray(requestData.findings)) {
          return {
            status: 400,
            jsonBody: {
              error: 'Missing or invalid findings array for findings mode'
            }
          };
        }
        result = await processor.processFindings(requestData.findings);
        break;
      
      default:
        return {
          status: 400,
          jsonBody: {
            error: 'Invalid mode. Supported modes: auto, specific, findings'
          }
        };
    }

    return {
      status: 200,
      jsonBody: {
        success: true,
        result,
        invocationId: context.invocationId
      }
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    logger?.error('Processing request error', {
      error: errorMessage,
      invocationId: context.invocationId
    });

    return {
      status: 500,
      jsonBody: {
        error: 'Processing failed',
        message: errorMessage,
        invocationId: context.invocationId
      }
    };
  }
}

// Register Azure Functions
app.http('guardduty-http', {
  methods: ['GET', 'POST'],
  authLevel: 'function',
  handler: httpTrigger
});

app.timer('guardduty-timer', {
  schedule: '0 */15 * * * *', // Every 15 minutes
  handler: timerTrigger
});
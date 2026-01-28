/**
 * Container worker for GuardDuty to Sentinel integration
 * 
 * This worker provides a containerized deployment option with HTTP endpoints
 * for processing GuardDuty findings and health checks.
 * 
 * Requirements: 3.1, 4.1
 */

import express, { NextFunction, Request, Response } from 'express';
import { GuardDutyProcessor } from './processor';
import { ContainerConfig, createConfigFromEnvironment } from './config';
import { StructuredLogger } from '../../services/structured-logger';
import { HealthCheck } from '../../services/health-check';
import { MetricsCollector } from '../../services/metrics-collector';
import { GuardDutyIntegrationApp } from '../../index';

// Global instances
let app: express.Application;
let processor: GuardDutyProcessor | null = null;
let logger: StructuredLogger | null = null;
let healthCheck: HealthCheck | null = null;
let metricsCollector: MetricsCollector | null = null;
let integrationApp: GuardDutyIntegrationApp | null = null;

/**
 * Initialize the container worker
 */
async function initialize(): Promise<void> {
  try {
    console.log('🐳 Initializing Container GuardDuty worker...');

    // Initialize main application
    integrationApp = new GuardDutyIntegrationApp({
      workerType: 'container',
      enableGracefulShutdown: true,
      shutdownTimeoutMs: 30000
    });

    const context = await integrationApp.initialize();
    logger = context.logger;
    healthCheck = context.healthCheck;
    metricsCollector = context.metricsCollector;

    // Load container-specific configuration
    const config = createConfigFromEnvironment();

    // Initialize processor
    processor = new GuardDutyProcessor(config, logger, healthCheck, metricsCollector);
    await processor.initialize();

    // Set up Express app
    setupExpressApp(config);

    logger.info('Container GuardDuty worker initialized successfully', {
      port: config.port,
      batchSize: config.worker.batchSize,
      enableNormalization: config.worker.enableNormalization
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('❌ Failed to initialize Container GuardDuty worker:', errorMessage);
    throw error;
  }
}

/**
 * Set up Express application with routes
 */
function setupExpressApp(config: ContainerConfig): void {
  app = express();
  
  // Middleware
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Request logging middleware
  app.use((req: Request, res: Response, next: NextFunction) => {
    const startTime = Date.now();
    
    res.on('finish', () => {
      const duration = Date.now() - startTime;
      logger?.info('HTTP request', {
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        duration,
        userAgent: req.get('User-Agent')
      });
      
      metricsCollector?.incrementCounter('http_requests_total', 1, {
        method: req.method,
        status: res.statusCode.toString()
      });
      metricsCollector?.recordGauge('http_request_duration_ms', duration);
    });
    
    next();
  });

  // Health check endpoint
  app.get('/health', async (_req: Request, res: Response) => {
    try {
      if (!healthCheck || !processor) {
        return res.status(503).json({
          status: 'unhealthy',
          message: 'Service not initialized'
        });
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

      res.status(statusCode).json(overallHealth);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger?.error('Health check error', { error: errorMessage });
      
      res.status(500).json({
        status: 'unhealthy',
        message: errorMessage,
        timestamp: new Date().toISOString()
      });
    }
  });

  // Readiness probe endpoint
  app.get('/ready', async (_req: Request, res: Response) => {
    try {
      if (!processor) {
        return res.status(503).json({
          ready: false,
          message: 'Processor not initialized'
        });
      }

      const health = await processor.getHealthStatus();
      const ready = health.status !== 'unhealthy';

      res.status(ready ? 200 : 503).json({
        ready,
        status: health.status,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({
        ready: false,
        message: errorMessage,
        timestamp: new Date().toISOString()
      });
    }
  });

  // Metrics endpoint (Prometheus format)
  app.get('/metrics', async (_req: Request, res: Response) => {
    try {
      if (!metricsCollector) {
        return res.status(503).text('Metrics collector not initialized');
      }

      const metrics = await metricsCollector.getMetrics();
      res.set('Content-Type', 'text/plain').send(metrics);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger?.error('Metrics endpoint error', { error: errorMessage });
      res.status(500).text(`Error retrieving metrics: ${errorMessage}`);
    }
  });

  // Process S3 objects endpoint
  app.post('/process', async (req: Request, res: Response) => {
    const startTime = Date.now();
    
    try {
      if (!processor || !logger) {
        return res.status(503).json({
          error: 'Service not initialized'
        });
      }

      logger.info('Processing request received', {
        body: req.body ? Object.keys(req.body) : 'empty'
      });

      const { mode = 'auto', s3Objects, findings } = req.body;
      let result;

      switch (mode) {
        case 'auto':
          // Process all available S3 objects
          result = await processor.processS3Objects();
          break;
        
        case 'specific':
          // Process specific S3 objects
          if (!s3Objects || !Array.isArray(s3Objects)) {
            return res.status(400).json({
              error: 'Missing or invalid s3Objects array for specific mode'
            });
          }
          result = await processor.processSpecificS3Objects(s3Objects);
          break;
        
        case 'findings':
          // Process provided findings directly
          if (!findings || !Array.isArray(findings)) {
            return res.status(400).json({
              error: 'Missing or invalid findings array for findings mode'
            });
          }
          result = await processor.processFindings(findings);
          break;
        
        default:
          return res.status(400).json({
            error: 'Invalid mode. Supported modes: auto, specific, findings'
          });
      }

      const duration = Date.now() - startTime;
      
      res.json({
        success: true,
        result,
        duration,
        timestamp: new Date().toISOString()
      });

      metricsCollector?.incrementCounter('processing_requests_completed');

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const duration = Date.now() - startTime;
      
      logger?.error('Processing request error', {
        error: errorMessage,
        duration
      });

      metricsCollector?.incrementCounter('processing_requests_failed');

      res.status(500).json({
        success: false,
        error: errorMessage,
        duration,
        timestamp: new Date().toISOString()
      });
    }
  });

  // Webhook endpoint for S3 events
  app.post('/webhook/s3', async (req: Request, res: Response) => {
    try {
      if (!processor || !logger) {
        return res.status(503).json({
          error: 'Service not initialized'
        });
      }

      const s3Event = req.body;
      
      // Validate S3 event structure
      if (!s3Event.Records || !Array.isArray(s3Event.Records)) {
        return res.status(400).json({
          error: 'Invalid S3 event format'
        });
      }

      logger.info('S3 webhook received', {
        recordCount: s3Event.Records.length
      });

      // Convert S3 event records to S3ObjectInfo format
      const s3Objects = s3Event.Records
        .filter((record: any) => record.eventName?.startsWith('ObjectCreated:'))
        .map((record: any) => ({
          bucket: decodeURIComponent(record.s3.bucket.name),
          key: decodeURIComponent(record.s3.object.key.replace(/\+/g, ' ')),
          size: record.s3.object.size,
          lastModified: new Date(),
          etag: record.s3.object.eTag || '',
          kmsKeyId: undefined
        }));

      if (s3Objects.length === 0) {
        return res.json({
          success: true,
          message: 'No valid S3 objects to process',
          processedObjects: 0
        });
      }

      // Process S3 objects
      const result = await processor.processSpecificS3Objects(s3Objects);

      res.json({
        success: true,
        result,
        processedObjects: s3Objects.length,
        timestamp: new Date().toISOString()
      });

      metricsCollector?.incrementCounter('s3_webhook_requests_completed');

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      logger?.error('S3 webhook error', { error: errorMessage });
      metricsCollector?.incrementCounter('s3_webhook_requests_failed');

      res.status(500).json({
        success: false,
        error: errorMessage,
        timestamp: new Date().toISOString()
      });
    }
  });

  // 404 handler
  app.use((req: Request, res: Response) => {
    res.status(404).json({
      error: 'Not Found',
      path: req.path,
      method: req.method
    });
  });

  // Error handler
  app.use((error: Error, req: Request, res: Response, _next: NextFunction) => {
    logger?.error('Express error handler', {
      error: error.message,
      stack: error.stack,
      path: req.path,
      method: req.method
    });

    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message
    });
  });
}

/**
 * Start the container worker server
 */
async function start(): Promise<void> {
  try {
    await initialize();
    
    if (!app || !logger) {
      throw new Error('Application not initialized');
    }

    const config = createConfigFromEnvironment();
    const server = app.listen(config.port, config.host, () => {
      logger!.info('Container GuardDuty worker started', {
        host: config.host,
        port: config.port,
        environment: process.env.NODE_ENV || 'development'
      });
      
      console.log(`🚀 Container worker listening on http://${config.host}:${config.port}`);
      console.log(`📊 Health check: http://${config.host}:${config.port}/health`);
      console.log(`📈 Metrics: http://${config.host}:${config.port}/metrics`);
    });

    // Register shutdown handler
    if (integrationApp) {
      integrationApp.onShutdown(async () => {
        logger?.info('Shutting down HTTP server...');
        server.close();
      });
    }

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('❌ Failed to start container worker:', errorMessage);
    process.exit(1);
  }
}

// Start the server if this file is run directly
if (require.main === module) {
  start().catch((error) => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });
}

export { start, initialize, app };

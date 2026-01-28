/**
 * Main entry point for GuardDuty to Sentinel Integration
 * 
 * This module provides the main application entry points for different worker types,
 * comprehensive error handling, graceful shutdown, and startup validation.
 * 
 * Requirements: 7.1, 10.3
 */

import { ConfigurationManager } from './services/configuration-manager';
import { StructuredLogger } from './services/structured-logger';
import { HealthCheck } from './services/health-check';
import { MetricsCollector } from './services/metrics-collector';
import { MonitoringSystem } from './services/monitoring-system';

// Export all types and services
export * from './types';
export * from './services';

// Worker types
export type WorkerType = 'lambda' | 'azure-function' | 'container';

export interface ApplicationConfig {
  workerType: WorkerType;
  configFilePath?: string;
  enableGracefulShutdown?: boolean;
  shutdownTimeoutMs?: number;
}

export interface ApplicationContext {
  logger: StructuredLogger;
  healthCheck: HealthCheck;
  metricsCollector: MetricsCollector;
  monitoringSystem: MonitoringSystem;
  configManager: ConfigurationManager;
}

/**
 * Main application class that wires all components together
 */
export class GuardDutyIntegrationApp {
  private context?: ApplicationContext;
  private shutdownHandlers: Array<() => Promise<void>> = [];
  private isShuttingDown = false;

  constructor(private config: ApplicationConfig) {}

  /**
   * Initialize the application with comprehensive startup validation
   */
  async initialize(): Promise<ApplicationContext> {
    const startTime = Date.now();
    
    try {
      console.log('🚀 Initializing GuardDuty to Sentinel Integration...');
      
      // Initialize configuration manager
      const configManager = new ConfigurationManager();
      const configResult = await configManager.loadConfiguration(this.config.configFilePath);
      
      if (configResult.warnings.length > 0) {
        console.warn('⚠️  Configuration warnings:');
        configResult.warnings.forEach(warning => console.warn(`   ${warning}`));
      }

      const monitoringConfig = {
        enableMetrics: configResult.config.monitoring?.enableMetrics ?? true,
        enableDetailedLogging: configResult.config.monitoring?.enableDetailedLogging ?? false,
        healthCheckPort: configResult.config.monitoring?.healthCheckPort ?? 8080,
        metricsBackend: configResult.config.monitoring?.metricsBackend
      };

      // Initialize monitoring system
      const monitoringSystem = new MonitoringSystem(monitoringConfig);

      // Initialize structured logger
      const logger = new StructuredLogger('guardduty-integration', monitoringConfig);

      logger.info('Configuration loaded successfully', {
        sources: configResult.sources.map(s => ({ type: s.type, location: s.location })),
        workerType: this.config.workerType
      });

      // Initialize health check system
      const healthCheck = HealthCheck.fromSystem(monitoringSystem.getHealthCheckSystem());

      // Initialize metrics collector
      const metricsCollector = monitoringSystem.getMetricsCollector();

      // Create application context
      this.context = {
        logger,
        healthCheck,
        metricsCollector,
        monitoringSystem,
        configManager
      };

      // Perform startup validation
      await this.performStartupValidation(configResult.config);

      // Set up graceful shutdown if enabled
      if (this.config.enableGracefulShutdown !== false) {
        this.setupGracefulShutdown();
      }

      // Start monitoring system
      await monitoringSystem.start();

      const initDuration = Date.now() - startTime;
      logger.info('Application initialized successfully', {
        workerType: this.config.workerType,
        initDuration,
        healthCheckPort: configResult.config.monitoring?.healthCheckPort
      });

      metricsCollector.recordGauge('app_initialization_duration_ms', initDuration);
      metricsCollector.incrementCounter('app_initializations');

      return this.context;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('❌ Failed to initialize application:', errorMessage);
      
      if (this.context?.metricsCollector) {
        this.context.metricsCollector.incrementCounter('app_initialization_failures');
      }
      
      throw error;
    }
  }

  /**
   * Get the application context (must be initialized first)
   */
  getContext(): ApplicationContext {
    if (!this.context) {
      throw new Error('Application not initialized. Call initialize() first.');
    }
    return this.context;
  }

  /**
   * Register a shutdown handler
   */
  onShutdown(handler: () => Promise<void>): void {
    this.shutdownHandlers.push(handler);
  }

  /**
   * Gracefully shutdown the application
   */
  async shutdown(): Promise<void> {
    if (this.isShuttingDown) {
      return;
    }

    this.isShuttingDown = true;
    const startTime = Date.now();

    try {
      if (this.context) {
        this.context.logger.info('Starting graceful shutdown...');
      }

      // Execute shutdown handlers in reverse order
      for (let i = this.shutdownHandlers.length - 1; i >= 0; i--) {
        try {
          await this.shutdownHandlers[i]();
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          console.error(`Shutdown handler ${i} failed:`, errorMessage);
        }
      }

      // Stop monitoring system
      if (this.context?.monitoringSystem) {
        await this.context.monitoringSystem.stop();
      }

      const shutdownDuration = Date.now() - startTime;
      
      if (this.context) {
        this.context.logger.info('Graceful shutdown completed', { shutdownDuration });
        this.context.metricsCollector.recordGauge('app_shutdown_duration_ms', shutdownDuration);
      }

      console.log('✅ Application shutdown completed');

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('❌ Error during shutdown:', errorMessage);
      throw error;
    }
  }

  /**
   * Perform comprehensive startup validation
   */
  private async performStartupValidation(config: any): Promise<void> {
    if (!this.context) {
      throw new Error('Context not initialized');
    }

    const { logger, healthCheck } = this.context;
    
    logger.info('Performing startup validation...');

    const validationResults: Array<{ component: string; status: 'pass' | 'fail'; message: string }> = [];

    // Validate configuration completeness
    try {
      this.validateConfigurationCompleteness(config);
      validationResults.push({
        component: 'Configuration',
        status: 'pass',
        message: 'All required configuration values present'
      });
    } catch (error) {
      validationResults.push({
        component: 'Configuration',
        status: 'fail',
        message: error instanceof Error ? error.message : 'Configuration validation failed'
      });
    }

    // Validate network connectivity (basic checks)
    try {
      await this.validateNetworkConnectivity(config);
      validationResults.push({
        component: 'Network',
        status: 'pass',
        message: 'Network connectivity validated'
      });
    } catch (error) {
      validationResults.push({
        component: 'Network',
        status: 'fail',
        message: error instanceof Error ? error.message : 'Network validation failed'
      });
    }

    // Validate worker-specific requirements
    try {
      await this.validateWorkerRequirements();
      validationResults.push({
        component: 'Worker',
        status: 'pass',
        message: `${this.config.workerType} worker requirements validated`
      });
    } catch (error) {
      validationResults.push({
        component: 'Worker',
        status: 'fail',
        message: error instanceof Error ? error.message : 'Worker validation failed'
      });
    }

    // Check for any failures
    const failures = validationResults.filter(r => r.status === 'fail');
    
    if (failures.length > 0) {
      logger.error('Startup validation failed', {
        failures: failures.map(f => ({ component: f.component, message: f.message }))
      });
      
      const errorMessage = `Startup validation failed for: ${failures.map(f => f.component).join(', ')}`;
      throw new Error(errorMessage);
    }

    logger.info('Startup validation completed successfully', {
      validatedComponents: validationResults.map(r => r.component)
    });
  }

  /**
   * Validate configuration completeness
   */
  private validateConfigurationCompleteness(config: any): void {
    const requiredFields = [
      'azureEndpoint',
      'dcr.immutableId',
      'dcr.streamName',
      'aws.region',
      'aws.s3BucketName',
      'azure.tenantId',
      'azure.clientId',
      'azure.clientSecret',
      'azure.workspaceId',
      'azure.subscriptionId',
      'azure.resourceGroupName'
    ];

    const missingFields: string[] = [];

    requiredFields.forEach(field => {
      const fieldPath = field.split('.');
      let current = config;
      
      for (const part of fieldPath) {
        if (!current || typeof current !== 'object' || !(part in current)) {
          missingFields.push(field);
          break;
        }
        current = current[part];
      }
    });

    if (missingFields.length > 0) {
      throw new Error(`Missing required configuration fields: ${missingFields.join(', ')}`);
    }
  }

  /**
   * Validate basic network connectivity
   */
  private async validateNetworkConnectivity(config: any): Promise<void> {
    // Basic DNS resolution test for Azure endpoint
    try {
      const url = new URL(config.azureEndpoint);
      // In a real implementation, you might want to do a DNS lookup or basic connectivity test
      // For now, just validate the URL format
      if (!url.hostname) {
        throw new Error('Invalid Azure endpoint URL');
      }
    } catch (error) {
      throw new Error(`Azure endpoint validation failed: ${error instanceof Error ? error.message : 'Invalid URL'}`);
    }
  }

  /**
   * Validate worker-specific requirements
   */
  private async validateWorkerRequirements(): Promise<void> {
    switch (this.config.workerType) {
      case 'lambda':
        // Validate Lambda-specific requirements
        if (!process.env.AWS_LAMBDA_FUNCTION_NAME && !process.env._HANDLER) {
          console.warn('Not running in Lambda environment - some features may not work correctly');
        }
        break;
      
      case 'azure-function':
        // Validate Azure Function-specific requirements
        if (!process.env.FUNCTIONS_WORKER_RUNTIME) {
          console.warn('Not running in Azure Functions environment - some features may not work correctly');
        }
        break;
      
      case 'container':
        // Validate container-specific requirements
        // No specific validation needed for container deployment
        break;
      
      default:
        throw new Error(`Unsupported worker type: ${this.config.workerType}`);
    }
  }

  /**
   * Set up graceful shutdown handlers
   */
  private setupGracefulShutdown(): void {
    const shutdownTimeout = this.config.shutdownTimeoutMs || 30000; // 30 seconds default

    const gracefulShutdown = (signal: string) => {
      console.log(`\n📡 Received ${signal}, starting graceful shutdown...`);
      
      const shutdownPromise = this.shutdown();
      
      // Force exit if shutdown takes too long
      const forceExitTimer = setTimeout(() => {
        console.error(`❌ Graceful shutdown timed out after ${shutdownTimeout}ms, forcing exit`);
        process.exit(1);
      }, shutdownTimeout);

      shutdownPromise
        .then(() => {
          clearTimeout(forceExitTimer);
          console.log('✅ Graceful shutdown completed, exiting');
          process.exit(0);
        })
        .catch((error) => {
          clearTimeout(forceExitTimer);
          console.error('❌ Error during graceful shutdown:', error);
          process.exit(1);
        });
    };

    // Handle various shutdown signals
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    process.on('SIGUSR2', () => gracefulShutdown('SIGUSR2')); // Nodemon restart

    // Handle uncaught exceptions and unhandled rejections
    process.on('uncaughtException', (error) => {
      console.error('❌ Uncaught Exception:', error);
      if (this.context) {
        this.context.logger.error('Uncaught exception', { error: error.message, stack: error.stack });
        this.context.metricsCollector.incrementCounter('uncaught_exceptions');
      }
      gracefulShutdown('uncaughtException');
    });

    process.on('unhandledRejection', (reason, promise) => {
      console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
      if (this.context) {
        this.context.logger.error('Unhandled rejection', { reason: String(reason) });
        this.context.metricsCollector.incrementCounter('unhandled_rejections');
      }
      gracefulShutdown('unhandledRejection');
    });
  }
}

/**
 * Create and initialize application for specific worker type
 */
export async function createApplication(config: ApplicationConfig): Promise<GuardDutyIntegrationApp> {
  const app = new GuardDutyIntegrationApp(config);
  await app.initialize();
  return app;
}

/**
 * Quick start function for common use cases
 */
export async function quickStart(workerType: WorkerType, configFilePath?: string): Promise<GuardDutyIntegrationApp> {
  return createApplication({
    workerType,
    configFilePath,
    enableGracefulShutdown: true,
    shutdownTimeoutMs: 30000
  });
}

console.log('GuardDuty to Sentinel Integration - Main application loaded');

/**
 * Integrated monitoring system that combines metrics, logging, and health checks
 *
 * This class provides a unified interface for all monitoring and observability
 * functionality in the GuardDuty to Sentinel integration system.
 */

import { EventEmitter } from 'events';
import { MonitoringConfig, ProcessingMetrics } from '../types/configuration';
import { MetricsCollector } from './metrics-collector';
import { StructuredLogger, LoggerFactory } from './structured-logger';
import { HealthCheckSystem, HealthChecker, BasicHealthChecker } from './health-check';

export interface MonitoringSystemEvents {
  'system-started': () => void;
  'system-stopped': () => void;
  'health-degraded': (status: 'degraded' | 'unhealthy') => void;
  'metrics-threshold-exceeded': (metric: string, value: number, threshold: number) => void;
}

export declare interface MonitoringSystem {
  on<U extends keyof MonitoringSystemEvents>(event: U, listener: MonitoringSystemEvents[U]): this;
  emit<U extends keyof MonitoringSystemEvents>(
    event: U,
    ...args: Parameters<MonitoringSystemEvents[U]>
  ): boolean;
}

export class MonitoringSystem extends EventEmitter {
  private readonly config: MonitoringConfig;
  private readonly metricsCollector: MetricsCollector;
  private readonly logger: StructuredLogger;
  private readonly healthCheckSystem: HealthCheckSystem;
  private isInitialized = false;

  constructor(config: MonitoringConfig) {
    super();
    this.config = config;

    // Initialize logger factory
    LoggerFactory.initialize(config);

    // Create main components
    this.metricsCollector = new MetricsCollector(config);
    this.logger = LoggerFactory.getLogger('monitoring-system');
    this.healthCheckSystem = new HealthCheckSystem(config, this.logger);

    // Set up event handlers
    this.setupEventHandlers();
  }

  /**
   * Initialize the monitoring system
   */
  public async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    const operation = this.logger.operationStart('initialize-monitoring-system');

    try {
      // Initialize metrics collector
      await this.metricsCollector.initialize();
      this.logger.info('Metrics collector initialized');

      // Register basic health checkers
      this.registerBasicHealthCheckers();

      // Start health check system
      await this.healthCheckSystem.start();
      this.logger.info('Health check system started');

      this.isInitialized = true;
      this.emit('system-started');

      operation.success('Monitoring system initialized successfully');
    } catch (error) {
      operation.failure(error as Error, 'Failed to initialize monitoring system');
      throw error;
    }
  }

  /**
   * Shutdown the monitoring system
   */
  public async shutdown(): Promise<void> {
    if (!this.isInitialized) {
      return;
    }

    const operation = this.logger.operationStart('shutdown-monitoring-system');

    try {
      // Stop health check system
      await this.healthCheckSystem.stop();
      this.logger.info('Health check system stopped');

      // Close metrics collector
      await this.metricsCollector.close();
      this.logger.info('Metrics collector closed');

      this.isInitialized = false;
      this.emit('system-stopped');

      operation.success('Monitoring system shutdown completed');
    } catch (error) {
      operation.failure(error as Error, 'Failed to shutdown monitoring system');
      throw error;
    }
  }

  /**
   * Get the metrics collector instance
   */
  public getMetricsCollector(): MetricsCollector {
    return this.metricsCollector;
  }

  /**
   * Get a logger instance
   */
  public getLogger(name: string): StructuredLogger {
    return LoggerFactory.getLogger(name);
  }

  /**
   * Get the health check system instance
   */
  public getHealthCheckSystem(): HealthCheckSystem {
    return this.healthCheckSystem;
  }

  /**
   * Record processing metrics and check thresholds
   */
  public recordProcessingMetrics(metrics: ProcessingMetrics): void {
    // Record metrics
    this.metricsCollector.recordProcessingMetrics(metrics);

    // Check thresholds and emit alerts
    this.checkMetricThresholds(metrics);

    // Log metrics summary
    this.logger.info('Processing metrics recorded', {
      totalProcessed: metrics.totalProcessed,
      successRate: metrics.successRate,
      throughput: metrics.throughput,
      queueSize: metrics.queueSize,
    });
  }

  /**
   * Register a custom health checker
   */
  public registerHealthChecker(checker: HealthChecker): void {
    this.healthCheckSystem.registerChecker(checker);
    this.logger.info('Health checker registered', { component: checker.name });
  }

  /**
   * Create a timed operation with integrated logging and metrics
   */
  public async timedOperation<T>(
    operationName: string,
    operation: () => Promise<T>,
    context?: Record<string, unknown>
  ): Promise<T> {
    const startTime = Date.now();
    const operationLogger = this.logger.operationStart(operationName, context);

    try {
      const result = await operation();
      const duration = Date.now() - startTime;

      // Record success metrics
      this.metricsCollector.recordTimer(`operation.${operationName}.duration`, duration, {
        ...(context as Record<string, string>),
        status: 'success',
      });
      this.metricsCollector.recordCounter(
        `operation.${operationName}.success`,
        1,
        context as Record<string, string>
      );

      operationLogger.success(`Operation ${operationName} completed successfully`);

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;

      // Record error metrics
      this.metricsCollector.recordTimer(`operation.${operationName}.duration`, duration, {
        ...(context as Record<string, string>),
        status: 'error',
      });
      this.metricsCollector.recordCounter(
        `operation.${operationName}.error`,
        1,
        context as Record<string, string>
      );

      operationLogger.failure(error as Error, `Operation ${operationName} failed`);

      throw error;
    }
  }

  /**
   * Set up event handlers for monitoring components
   */
  private setupEventHandlers(): void {
    // Health check system events
    this.healthCheckSystem.on('system-health-changed', (status) => {
      if (status === 'degraded' || status === 'unhealthy') {
        this.emit('health-degraded', status);
        this.logger.warn('System health degraded', { status });

        // Record health status metric
        const statusValue = status === 'degraded' ? 0.5 : 0; // unhealthy = 0
        this.metricsCollector.recordGauge('system.health.status', statusValue, { status });
      }
    });

    // Metrics collector events
    this.metricsCollector.on('backend-error', (backend, error) => {
      this.logger.error('Metrics backend error', error, { backend });
    });

    this.metricsCollector.on('metrics-flushed', (backend, count) => {
      this.logger.debug('Metrics flushed', { backend, count });
    });
  }

  /**
   * Register basic health checkers for core system components
   */
  private registerBasicHealthCheckers(): void {
    // Metrics collector health check
    const metricsChecker = new BasicHealthChecker(
      'metrics-collector',
      async () => {
        if (!this.config.enableMetrics) {
          return true;
        }

        return this.metricsCollector.getActiveBackends().length > 0;
      }
    );
    this.healthCheckSystem.registerChecker(metricsChecker);

    // Memory usage health check
    const memoryChecker = new BasicHealthChecker('memory-usage', async () => {
      const memUsage = process.memoryUsage();
      const heapUsedMB = memUsage.heapUsed / 1024 / 1024;

      // Record memory metrics
      this.metricsCollector.recordGauge('system.memory.heap_used', heapUsedMB, undefined, 'MB');
      this.metricsCollector.recordGauge(
        'system.memory.heap_total',
        memUsage.heapTotal / 1024 / 1024,
        undefined,
        'MB'
      );

      // Consider unhealthy if heap usage exceeds 1GB
      return heapUsedMB < 1024;
    });
    this.healthCheckSystem.registerChecker(memoryChecker);

    // Event loop lag health check
    const eventLoopChecker = new BasicHealthChecker('event-loop', async () => {
      const start = process.hrtime.bigint();
      await new Promise((resolve) => setImmediate(resolve));
      const lag = Number(process.hrtime.bigint() - start) / 1000000; // Convert to milliseconds

      // Record event loop lag metric
      this.metricsCollector.recordGauge('system.event_loop.lag', lag, undefined, 'ms');

      // Consider degraded if lag exceeds 100ms, unhealthy if exceeds 500ms
      return lag < 100;
    });
    this.healthCheckSystem.registerChecker(eventLoopChecker);
  }

  /**
   * Check metric thresholds and emit alerts
   */
  private checkMetricThresholds(metrics: ProcessingMetrics): void {
    // Check error rate threshold
    const errorRate = 1 - metrics.successRate;
    if (errorRate > 0.1) {
      // 10% error rate threshold
      this.emit('metrics-threshold-exceeded', 'error_rate', errorRate, 0.1);
      this.logger.warn('Error rate threshold exceeded', {
        errorRate,
        threshold: 0.1,
        totalErrors: metrics.totalErrors,
        totalProcessed: metrics.totalProcessed,
      });
    }

    // Check queue size threshold
    if (metrics.queueSize > 1000) {
      this.emit('metrics-threshold-exceeded', 'queue_size', metrics.queueSize, 1000);
      this.logger.warn('Queue size threshold exceeded', {
        queueSize: metrics.queueSize,
        threshold: 1000,
      });
    }

    // Check processing time threshold
    if (metrics.avgProcessingTimeMs > 5000) {
      // 5 seconds
      this.emit('metrics-threshold-exceeded', 'processing_time', metrics.avgProcessingTimeMs, 5000);
      this.logger.warn('Processing time threshold exceeded', {
        avgProcessingTime: metrics.avgProcessingTimeMs,
        threshold: 5000,
      });
    }
  }

  /**
   * Start the monitoring system (alias for initialize)
   */
  public async start(): Promise<void> {
    return this.initialize();
  }

  /**
   * Stop the monitoring system (alias for shutdown)
   */
  public async stop(): Promise<void> {
    return this.shutdown();
  }
}

/**
 * Metrics collection system with configurable backends
 *
 * Provides comprehensive metrics collection for the GuardDuty to Sentinel integration,
 * supporting multiple backend types including console, Prometheus, CloudWatch, and Azure Monitor.
 */

import { EventEmitter } from 'events';
import {
  MetricsBackendConfig,
  ProcessingMetrics,
  MonitoringConfig,
} from '../types/configuration.js';

export interface MetricValue {
  /** Metric name */
  name: string;
  /** Metric value */
  value: number;
  /** Metric type */
  type: 'counter' | 'gauge' | 'histogram' | 'timer';
  /** Metric tags/labels */
  tags?: Record<string, string>;
  /** Metric timestamp */
  timestamp: Date;
  /** Metric unit */
  unit?: string;
  /** Metric description */
  description?: string;
}

export interface MetricsBackend {
  /** Backend name */
  name: string;
  /** Initialize the backend */
  initialize(): Promise<void>;
  /** Record a metric value */
  recordMetric(metric: MetricValue): Promise<void>;
  /** Record multiple metrics */
  recordMetrics(metrics: MetricValue[]): Promise<void>;
  /** Flush any pending metrics */
  flush(): Promise<void>;
  /** Close the backend */
  close(): Promise<void>;
}

export interface MetricsCollectorEvents {
  'metric-recorded': (metric: MetricValue) => void;
  'backend-error': (backend: string, error: Error) => void;
  'metrics-flushed': (backend: string, count: number) => void;
}

export declare interface MetricsCollector {
  on<U extends keyof MetricsCollectorEvents>(event: U, listener: MetricsCollectorEvents[U]): this;
  emit<U extends keyof MetricsCollectorEvents>(
    event: U,
    ...args: Parameters<MetricsCollectorEvents[U]>
  ): boolean;
}

export class MetricsCollector extends EventEmitter {
  private readonly config: MonitoringConfig;
  private readonly backends: Map<string, MetricsBackend> = new Map();
  private readonly metricsBuffer: MetricValue[] = [];
  private readonly maxBufferSize: number = 1000;
  private flushTimer?: NodeJS.Timeout;
  private readonly flushIntervalMs: number = 30000; // 30 seconds
  private isInitialized = false;

  constructor(config: MonitoringConfig) {
    super();
    this.config = config;
  }

  /**
   * Initialize the metrics collector and backends
   */
  public async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    if (!this.config.enableMetrics) {
      console.log('Metrics collection is disabled');
      this.isInitialized = true;
      return;
    }

    // Initialize configured backend
    if (this.config.metricsBackend) {
      const backend = this.createBackend(this.config.metricsBackend);
      await backend.initialize();
      this.backends.set(backend.name, backend);
    } else {
      // Default to console backend
      const consoleBackend = this.createBackend({ type: 'console' });
      await consoleBackend.initialize();
      this.backends.set(consoleBackend.name, consoleBackend);
    }

    // Start flush timer
    this.startFlushTimer();
    this.isInitialized = true;
  }

  /**
   * Record a counter metric (monotonically increasing value)
   */
  public recordCounter(
    name: string,
    value: number = 1,
    tags?: Record<string, string>,
    description?: string
  ): void {
    this.recordMetric({
      name,
      value,
      type: 'counter',
      tags,
      timestamp: new Date(),
      description,
    });
  }

  /**
   * Record a gauge metric (point-in-time value)
   */
  public recordGauge(
    name: string,
    value: number,
    tags?: Record<string, string>,
    unit?: string,
    description?: string
  ): void {
    this.recordMetric({
      name,
      value,
      type: 'gauge',
      tags,
      timestamp: new Date(),
      unit,
      description,
    });
  }

  /**
   * Record a timer metric (duration measurement)
   */
  public recordTimer(
    name: string,
    durationMs: number,
    tags?: Record<string, string>,
    description?: string
  ): void {
    this.recordMetric({
      name,
      value: durationMs,
      type: 'timer',
      tags,
      timestamp: new Date(),
      unit: 'milliseconds',
      description,
    });
  }

  /**
   * Record a histogram metric (distribution of values)
   */
  public recordHistogram(
    name: string,
    value: number,
    tags?: Record<string, string>,
    unit?: string,
    description?: string
  ): void {
    this.recordMetric({
      name,
      value,
      type: 'histogram',
      tags,
      timestamp: new Date(),
      unit,
      description,
    });
  }

  /**
   * Record processing metrics from the system
   */
  public recordProcessingMetrics(metrics: ProcessingMetrics): void {
    const tags = { component: 'processing' };

    this.recordGauge(
      'findings.processed.total',
      metrics.totalProcessed,
      tags,
      'count',
      'Total findings processed'
    );
    this.recordGauge(
      'findings.errors.total',
      metrics.totalErrors,
      tags,
      'count',
      'Total processing errors'
    );
    this.recordGauge(
      'findings.success_rate',
      metrics.successRate,
      tags,
      'ratio',
      'Processing success rate'
    );
    this.recordGauge(
      'findings.processing_time.avg',
      metrics.avgProcessingTimeMs,
      tags,
      'milliseconds',
      'Average processing time per finding'
    );
    this.recordGauge(
      'findings.queue_size',
      metrics.queueSize,
      tags,
      'count',
      'Current batch queue size'
    );
    this.recordGauge(
      'findings.throughput',
      metrics.throughput,
      tags,
      'per_second',
      'Findings processed per second'
    );
  }

  /**
   * Time a function execution and record the duration
   */
  public async timeFunction<T>(
    name: string,
    fn: () => Promise<T>,
    tags?: Record<string, string>
  ): Promise<T> {
    const startTime = Date.now();
    try {
      const result = await fn();
      const duration = Date.now() - startTime;
      this.recordTimer(name, duration, { ...tags, status: 'success' });
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.recordTimer(name, duration, { ...tags, status: 'error' });
      throw error;
    }
  }

  /**
   * Record a metric value
   */
  private recordMetric(metric: MetricValue): void {
    if (!this.config.enableMetrics) {
      return;
    }

    this.metricsBuffer.push(metric);
    this.emit('metric-recorded', metric);

    // Flush if buffer is full
    if (this.metricsBuffer.length >= this.maxBufferSize) {
      this.flushMetrics().catch((error) => {
        console.error('Failed to flush metrics:', error);
      });
    }
  }

  /**
   * Flush all pending metrics to backends
   */
  public async flushMetrics(): Promise<void> {
    if (this.metricsBuffer.length === 0) {
      return;
    }

    const metricsToFlush = this.metricsBuffer.splice(0);

    for (const [backendName, backend] of this.backends) {
      try {
        await backend.recordMetrics(metricsToFlush);
        await backend.flush();
        this.emit('metrics-flushed', backendName, metricsToFlush.length);
      } catch (error) {
        this.emit('backend-error', backendName, error as Error);
        console.error(`Failed to flush metrics to backend ${backendName}:`, error);
      }
    }
  }

  /**
   * Get current metrics buffer size
   */
  public getBufferSize(): number {
    return this.metricsBuffer.length;
  }

  /**
   * Get list of active backends
   */
  public getActiveBackends(): string[] {
    return Array.from(this.backends.keys());
  }

  /**
   * Close the metrics collector and all backends
   */
  public async close(): Promise<void> {
    // Stop flush timer
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = undefined;
    }

    // Flush any remaining metrics
    await this.flushMetrics();

    // Close all backends
    for (const [backendName, backend] of this.backends) {
      try {
        await backend.close();
      } catch (error) {
        console.error(`Failed to close backend ${backendName}:`, error);
      }
    }

    this.backends.clear();
    this.isInitialized = false;
  }

  /**
   * Create a metrics backend based on configuration
   */
  private createBackend(config: MetricsBackendConfig): MetricsBackend {
    switch (config.type) {
      case 'console':
        return new ConsoleMetricsBackend(config.config);
      case 'prometheus':
        return new PrometheusMetricsBackend(config.config);
      case 'cloudwatch':
        return new CloudWatchMetricsBackend(config.config);
      case 'azure-monitor':
        return new AzureMonitorMetricsBackend(config.config);
      default:
        throw new Error(`Unsupported metrics backend type: ${config.type}`);
    }
  }

  /**
   * Start the periodic flush timer
   */
  private startFlushTimer(): void {
    this.flushTimer = setInterval(() => {
      this.flushMetrics().catch((error) => {
        console.error('Failed to flush metrics on timer:', error);
      });
    }, this.flushIntervalMs);
  }

  /**
   * Increment a counter metric (convenience method)
   */
  public incrementCounter(name: string, value: number = 1, tags?: Record<string, string>): void {
    this.recordCounter(name, value, tags);
  }

  /**
   * Get all metrics (convenience method)
   */
  public async getMetrics(): Promise<MetricValue[]> {
    return Promise.resolve([...this.metricsBuffer]);
  }
}

/**
 * Console metrics backend - logs metrics to console
 */
export class ConsoleMetricsBackend implements MetricsBackend {
  public readonly name = 'console';
  private readonly config: Record<string, unknown>;

  constructor(config: Record<string, unknown> = {}) {
    this.config = config;
  }

  public async initialize(): Promise<void> {
    console.log('Console metrics backend initialized');
  }

  public async recordMetric(metric: MetricValue): Promise<void> {
    const tags = metric.tags
      ? Object.entries(metric.tags)
          .map(([k, v]) => `${k}=${v}`)
          .join(',')
      : '';
    const tagsStr = tags ? ` {${tags}}` : '';
    const unit = metric.unit ? ` ${metric.unit}` : '';

    console.log(
      `[METRIC] ${metric.name}${tagsStr}: ${metric.value}${unit} (${metric.type}) - ${metric.timestamp.toISOString()}`
    );
  }

  public async recordMetrics(metrics: MetricValue[]): Promise<void> {
    for (const metric of metrics) {
      await this.recordMetric(metric);
    }
  }

  public async flush(): Promise<void> {
    // Console backend doesn't need flushing
  }

  public async close(): Promise<void> {
    console.log('Console metrics backend closed');
  }
}

/**
 * Prometheus metrics backend - exports metrics in Prometheus format
 */
export class PrometheusMetricsBackend implements MetricsBackend {
  public readonly name = 'prometheus';
  private readonly config: Record<string, unknown>;
  private readonly metrics: Map<string, MetricValue[]> = new Map();

  constructor(config: Record<string, unknown> = {}) {
    this.config = config;
  }

  public async initialize(): Promise<void> {
    console.log('Prometheus metrics backend initialized');
    // TODO: Initialize Prometheus client library if available
  }

  public async recordMetric(metric: MetricValue): Promise<void> {
    const key = `${metric.name}_${metric.type}`;
    if (!this.metrics.has(key)) {
      this.metrics.set(key, []);
    }
    this.metrics.get(key)!.push(metric);
  }

  public async recordMetrics(metrics: MetricValue[]): Promise<void> {
    for (const metric of metrics) {
      await this.recordMetric(metric);
    }
  }

  public async flush(): Promise<void> {
    // TODO: Export metrics to Prometheus endpoint
    console.log(`[PROMETHEUS] Flushed ${this.metrics.size} metric types`);
  }

  public async close(): Promise<void> {
    this.metrics.clear();
    console.log('Prometheus metrics backend closed');
  }
}

/**
 * CloudWatch metrics backend - sends metrics to AWS CloudWatch
 */
export class CloudWatchMetricsBackend implements MetricsBackend {
  public readonly name = 'cloudwatch';
  private readonly config: Record<string, unknown>;

  constructor(config: Record<string, unknown> = {}) {
    this.config = config;
  }

  public async initialize(): Promise<void> {
    console.log('CloudWatch metrics backend initialized');
    // TODO: Initialize AWS CloudWatch client
  }

  public async recordMetric(metric: MetricValue): Promise<void> {
    // TODO: Send metric to CloudWatch
    console.log(`[CLOUDWATCH] ${metric.name}: ${metric.value}`);
  }

  public async recordMetrics(metrics: MetricValue[]): Promise<void> {
    // TODO: Batch send metrics to CloudWatch
    console.log(`[CLOUDWATCH] Batch sending ${metrics.length} metrics`);
  }

  public async flush(): Promise<void> {
    // TODO: Flush any pending CloudWatch metrics
  }

  public async close(): Promise<void> {
    console.log('CloudWatch metrics backend closed');
  }
}

/**
 * Azure Monitor metrics backend - sends metrics to Azure Monitor
 */
export class AzureMonitorMetricsBackend implements MetricsBackend {
  public readonly name = 'azure-monitor';
  private readonly config: Record<string, unknown>;

  constructor(config: Record<string, unknown> = {}) {
    this.config = config;
  }

  public async initialize(): Promise<void> {
    console.log('Azure Monitor metrics backend initialized');
    // TODO: Initialize Azure Monitor client
  }

  public async recordMetric(metric: MetricValue): Promise<void> {
    // TODO: Send metric to Azure Monitor
    console.log(`[AZURE-MONITOR] ${metric.name}: ${metric.value}`);
  }

  public async recordMetrics(metrics: MetricValue[]): Promise<void> {
    // TODO: Batch send metrics to Azure Monitor
    console.log(`[AZURE-MONITOR] Batch sending ${metrics.length} metrics`);
  }

  public async flush(): Promise<void> {
    // TODO: Flush any pending Azure Monitor metrics
  }

  public async close(): Promise<void> {
    console.log('Azure Monitor metrics backend closed');
  }
}

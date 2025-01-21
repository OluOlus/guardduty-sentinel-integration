/**
 * Unit tests for MetricsCollector
 */

import { MetricsCollector, MetricValue, ConsoleMetricsBackend } from '../../src/services/metrics-collector';
import { MonitoringConfig, ProcessingMetrics } from '../../src/types/configuration';

describe('MetricsCollector', () => {
  let config: MonitoringConfig;
  let metricsCollector: MetricsCollector;

  beforeEach(() => {
    config = {
      enableMetrics: true,
      enableDetailedLogging: false,
      healthCheckPort: 8080,
      metricsBackend: {
        type: 'console'
      }
    };
    metricsCollector = new MetricsCollector(config);
  });

  afterEach(async () => {
    await metricsCollector.close();
  });

  describe('initialization', () => {
    it('should initialize with metrics enabled', async () => {
      await metricsCollector.initialize();
      expect(metricsCollector.getActiveBackends()).toContain('console');
    });

    it('should not initialize backends when metrics disabled', async () => {
      config.enableMetrics = false;
      const disabledCollector = new MetricsCollector(config);
      
      await disabledCollector.initialize();
      expect(disabledCollector.getActiveBackends()).toHaveLength(0);
      
      await disabledCollector.close();
    });

    it('should use default console backend when no backend configured', async () => {
      config.metricsBackend = undefined;
      await metricsCollector.initialize();
      expect(metricsCollector.getActiveBackends()).toContain('console');
    });
  });

  describe('metric recording', () => {
    beforeEach(async () => {
      await metricsCollector.initialize();
    });

    it('should record counter metrics', () => {
      const metricRecorded = jest.fn();
      metricsCollector.on('metric-recorded', metricRecorded);

      metricsCollector.recordCounter('test.counter', 5, { component: 'test' });

      expect(metricRecorded).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'test.counter',
          value: 5,
          type: 'counter',
          tags: { component: 'test' }
        })
      );
    });

    it('should record gauge metrics', () => {
      const metricRecorded = jest.fn();
      metricsCollector.on('metric-recorded', metricRecorded);

      metricsCollector.recordGauge('test.gauge', 42.5, { component: 'test' }, 'bytes');

      expect(metricRecorded).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'test.gauge',
          value: 42.5,
          type: 'gauge',
          tags: { component: 'test' },
          unit: 'bytes'
        })
      );
    });

    it('should record timer metrics', () => {
      const metricRecorded = jest.fn();
      metricsCollector.on('metric-recorded', metricRecorded);

      metricsCollector.recordTimer('test.timer', 1500, { operation: 'process' });

      expect(metricRecorded).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'test.timer',
          value: 1500,
          type: 'timer',
          tags: { operation: 'process' },
          unit: 'milliseconds'
        })
      );
    });

    it('should record histogram metrics', () => {
      const metricRecorded = jest.fn();
      metricsCollector.on('metric-recorded', metricRecorded);

      metricsCollector.recordHistogram('test.histogram', 100, { bucket: '1' }, 'requests');

      expect(metricRecorded).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'test.histogram',
          value: 100,
          type: 'histogram',
          tags: { bucket: '1' },
          unit: 'requests'
        })
      );
    });

    it('should not record metrics when disabled', () => {
      config.enableMetrics = false;
      const disabledCollector = new MetricsCollector(config);
      const metricRecorded = jest.fn();
      disabledCollector.on('metric-recorded', metricRecorded);

      disabledCollector.recordCounter('test.counter', 1);

      expect(metricRecorded).not.toHaveBeenCalled();
    });
  });

  describe('processing metrics', () => {
    beforeEach(async () => {
      await metricsCollector.initialize();
    });

    it('should record processing metrics', () => {
      const metricRecorded = jest.fn();
      metricsCollector.on('metric-recorded', metricRecorded);

      const processingMetrics: ProcessingMetrics = {
        totalProcessed: 100,
        totalErrors: 5,
        successRate: 0.95,
        avgProcessingTimeMs: 250,
        queueSize: 10,
        throughput: 4.2,
        timestamp: new Date()
      };

      metricsCollector.recordProcessingMetrics(processingMetrics);

      expect(metricRecorded).toHaveBeenCalledTimes(6);
      expect(metricRecorded).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'findings.processed.total',
          value: 100,
          type: 'gauge'
        })
      );
      expect(metricRecorded).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'findings.success_rate',
          value: 0.95,
          type: 'gauge'
        })
      );
    });
  });

  describe('function timing', () => {
    beforeEach(async () => {
      await metricsCollector.initialize();
    });

    it('should time successful function execution', async () => {
      const metricRecorded = jest.fn();
      metricsCollector.on('metric-recorded', metricRecorded);

      const testFunction = jest.fn().mockResolvedValue('success');
      
      const result = await metricsCollector.timeFunction(
        'test.operation',
        testFunction,
        { component: 'test' }
      );

      expect(result).toBe('success');
      expect(testFunction).toHaveBeenCalled();
      expect(metricRecorded).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'test.operation',
          type: 'timer',
          tags: { component: 'test', status: 'success' }
        })
      );
    });

    it('should time failed function execution', async () => {
      const metricRecorded = jest.fn();
      metricsCollector.on('metric-recorded', metricRecorded);

      const testError = new Error('Test error');
      const testFunction = jest.fn().mockRejectedValue(testError);
      
      await expect(
        metricsCollector.timeFunction('test.operation', testFunction, { component: 'test' })
      ).rejects.toThrow('Test error');

      expect(metricRecorded).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'test.operation',
          type: 'timer',
          tags: { component: 'test', status: 'error' }
        })
      );
    });
  });

  describe('buffer management', () => {
    beforeEach(async () => {
      await metricsCollector.initialize();
    });

    it('should track buffer size', () => {
      expect(metricsCollector.getBufferSize()).toBe(0);
      
      metricsCollector.recordCounter('test.counter', 1);
      expect(metricsCollector.getBufferSize()).toBe(1);
      
      metricsCollector.recordGauge('test.gauge', 42);
      expect(metricsCollector.getBufferSize()).toBe(2);
    });

    it('should flush metrics manually', async () => {
      const metricsFlushed = jest.fn();
      metricsCollector.on('metrics-flushed', metricsFlushed);

      metricsCollector.recordCounter('test.counter', 1);
      metricsCollector.recordGauge('test.gauge', 42);
      
      expect(metricsCollector.getBufferSize()).toBe(2);
      
      await metricsCollector.flushMetrics();
      
      expect(metricsCollector.getBufferSize()).toBe(0);
      expect(metricsFlushed).toHaveBeenCalledWith('console', 2);
    });
  });

  describe('backend management', () => {
    it('should support different backend types', () => {
      const consoleBackend = new ConsoleMetricsBackend();
      expect(consoleBackend.name).toBe('console');
    });

    it('should handle backend errors gracefully', async () => {
      await metricsCollector.initialize();
      
      const backendError = jest.fn();
      metricsCollector.on('backend-error', backendError);

      // Mock backend to throw error
      const backend = metricsCollector['backends'].get('console');
      if (backend) {
        const originalFlush = backend.flush;
        backend.flush = jest.fn().mockRejectedValue(new Error('Backend error'));
        
        metricsCollector.recordCounter('test.counter', 1);
        await metricsCollector.flushMetrics();
        
        expect(backendError).toHaveBeenCalledWith('console', expect.any(Error));
        
        // Restore original method
        backend.flush = originalFlush;
      }
    });
  });

  describe('cleanup', () => {
    it('should close cleanly', async () => {
      await metricsCollector.initialize();
      
      metricsCollector.recordCounter('test.counter', 1);
      expect(metricsCollector.getBufferSize()).toBe(1);
      
      await metricsCollector.close();
      
      expect(metricsCollector.getActiveBackends()).toHaveLength(0);
      expect(metricsCollector.getBufferSize()).toBe(0);
    });
  });
});

describe('ConsoleMetricsBackend', () => {
  let backend: ConsoleMetricsBackend;
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    backend = new ConsoleMetricsBackend();
    consoleSpy = jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('should initialize successfully', async () => {
    await backend.initialize();
    expect(consoleSpy).toHaveBeenCalledWith('Console metrics backend initialized');
  });

  it('should record single metric', async () => {
    const metric: MetricValue = {
      name: 'test.metric',
      value: 42,
      type: 'gauge',
      tags: { component: 'test' },
      timestamp: new Date(),
      unit: 'bytes'
    };

    await backend.recordMetric(metric);
    
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[METRIC] test.metric {component=test}: 42 bytes (gauge)')
    );
  });

  it('should record multiple metrics', async () => {
    const metrics: MetricValue[] = [
      {
        name: 'test.counter',
        value: 1,
        type: 'counter',
        timestamp: new Date()
      },
      {
        name: 'test.gauge',
        value: 50,
        type: 'gauge',
        timestamp: new Date()
      }
    ];

    await backend.recordMetrics(metrics);
    
    expect(consoleSpy).toHaveBeenCalledTimes(2);
  });

  it('should handle metrics without tags or units', async () => {
    const metric: MetricValue = {
      name: 'simple.metric',
      value: 100,
      type: 'counter',
      timestamp: new Date()
    };

    await backend.recordMetric(metric);
    
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[METRIC] simple.metric: 100 (counter)')
    );
  });

  it('should close successfully', async () => {
    await backend.close();
    expect(consoleSpy).toHaveBeenCalledWith('Console metrics backend closed');
  });
});
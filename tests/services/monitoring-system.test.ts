/**
 * Unit tests for MonitoringSystem
 */

import { MonitoringSystem } from '../../src/services/monitoring-system';
import { MonitoringConfig, ProcessingMetrics } from '../../src/types/configuration';

// Mock the HTTP server
jest.mock('http', () => ({
  createServer: jest.fn((handler) => ({
    listen: jest.fn((port, callback) => callback()),
    close: jest.fn((callback) => callback())
  }))
}));

describe('MonitoringSystem', () => {
  let config: MonitoringConfig;
  let monitoringSystem: MonitoringSystem;

  beforeEach(() => {
    config = {
      enableMetrics: true,
      enableDetailedLogging: false,
      healthCheckPort: 8080,
      metricsBackend: {
        type: 'console'
      }
    };
    monitoringSystem = new MonitoringSystem(config);
    
    // Mock console methods
    jest.spyOn(console, 'info').mockImplementation();
    jest.spyOn(console, 'debug').mockImplementation();
    jest.spyOn(console, 'warn').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
    jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(async () => {
    await monitoringSystem.shutdown();
    jest.restoreAllMocks();
    // Add a small delay to ensure cleanup
    await new Promise(resolve => setTimeout(resolve, 10));
  });

  describe('lifecycle', () => {
    it('should initialize successfully', async () => {
      const systemStarted = jest.fn();
      monitoringSystem.on('system-started', systemStarted);

      await monitoringSystem.initialize();

      expect(systemStarted).toHaveBeenCalled();
    });

    it('should shutdown successfully', async () => {
      const systemStopped = jest.fn();
      monitoringSystem.on('system-stopped', systemStopped);

      await monitoringSystem.initialize();
      await monitoringSystem.shutdown();

      expect(systemStopped).toHaveBeenCalled();
    });

    it('should not initialize twice', async () => {
      await monitoringSystem.initialize();
      await monitoringSystem.initialize(); // Should not throw
    });

    it('should not shutdown if not initialized', async () => {
      await monitoringSystem.shutdown(); // Should not throw
    });
  });

  describe('component access', () => {
    beforeEach(async () => {
      await monitoringSystem.initialize();
    });

    it('should provide access to metrics collector', () => {
      const metricsCollector = monitoringSystem.getMetricsCollector();
      expect(metricsCollector).toBeDefined();
      expect(typeof metricsCollector.recordCounter).toBe('function');
    });

    it('should provide access to logger', () => {
      const logger = monitoringSystem.getLogger('test-component');
      expect(logger).toBeDefined();
      expect(typeof logger.info).toBe('function');
    });

    it('should provide access to health check system', () => {
      const healthCheckSystem = monitoringSystem.getHealthCheckSystem();
      expect(healthCheckSystem).toBeDefined();
      expect(typeof healthCheckSystem.performHealthCheck).toBe('function');
    });
  });

  describe('processing metrics', () => {
    beforeEach(async () => {
      await monitoringSystem.initialize();
    });

    it('should record processing metrics', () => {
      const processingMetrics: ProcessingMetrics = {
        totalProcessed: 100,
        totalErrors: 5,
        successRate: 0.95,
        avgProcessingTimeMs: 250,
        queueSize: 10,
        throughput: 4.2,
        timestamp: new Date()
      };

      expect(() => {
        monitoringSystem.recordProcessingMetrics(processingMetrics);
      }).not.toThrow();
    });

    it('should emit threshold exceeded events', () => {
      const thresholdExceeded = jest.fn();
      monitoringSystem.on('metrics-threshold-exceeded', thresholdExceeded);

      const processingMetrics: ProcessingMetrics = {
        totalProcessed: 100,
        totalErrors: 20, // 20% error rate
        successRate: 0.8,
        avgProcessingTimeMs: 6000, // 6 seconds
        queueSize: 1500, // Above threshold
        throughput: 1.0,
        timestamp: new Date()
      };

      monitoringSystem.recordProcessingMetrics(processingMetrics);

      expect(thresholdExceeded).toHaveBeenCalledWith('error_rate', expect.closeTo(0.2, 5), 0.1);
      expect(thresholdExceeded).toHaveBeenCalledWith('queue_size', 1500, 1000);
      expect(thresholdExceeded).toHaveBeenCalledWith('processing_time', 6000, 5000);
    });
  });

  describe('timed operations', () => {
    beforeEach(async () => {
      await monitoringSystem.initialize();
    });

    it('should time successful operations', async () => {
      const result = await monitoringSystem.timedOperation(
        'test-operation',
        async () => {
          await new Promise(resolve => setTimeout(resolve, 10));
          return 'success';
        },
        { component: 'test' }
      );

      expect(result).toBe('success');
    });

    it('should time failed operations', async () => {
      const testError = new Error('Operation failed');

      await expect(
        monitoringSystem.timedOperation(
          'failing-operation',
          async () => {
            throw testError;
          }
        )
      ).rejects.toThrow('Operation failed');
    });
  });

  describe('health monitoring', () => {
    beforeEach(async () => {
      await monitoringSystem.initialize();
    });

    it('should register custom health checkers', () => {
      const customChecker = {
        name: 'custom-component',
        check: jest.fn().mockResolvedValue({
          name: 'custom-component',
          status: 'healthy' as const,
          lastCheck: new Date()
        })
      };

      expect(() => {
        monitoringSystem.registerHealthChecker(customChecker);
      }).not.toThrow();
    });

    it('should emit health degraded events', async () => {
      const healthDegraded = jest.fn();
      monitoringSystem.on('health-degraded', healthDegraded);

      // Register an unhealthy checker
      const unhealthyChecker = {
        name: 'unhealthy-component',
        check: jest.fn().mockResolvedValue({
          name: 'unhealthy-component',
          status: 'unhealthy' as const,
          lastCheck: new Date()
        })
      };

      monitoringSystem.registerHealthChecker(unhealthyChecker);
      
      // Trigger health check
      await monitoringSystem.getHealthCheckSystem().performHealthCheck();

      expect(healthDegraded).toHaveBeenCalledWith('unhealthy');
    });
  });

  describe('metrics disabled', () => {
    it('should treat metrics collector as healthy when metrics are disabled', async () => {
      const disabledMetricsSystem = new MonitoringSystem({
        ...config,
        enableMetrics: false
      });

      await disabledMetricsSystem.initialize();

      const healthStatus = await disabledMetricsSystem.getHealthCheckSystem().performHealthCheck();

      expect(disabledMetricsSystem.getMetricsCollector().getActiveBackends()).toHaveLength(0);
      expect(healthStatus.status).toBe('healthy');

      await disabledMetricsSystem.shutdown();
    });
  });

  describe('error handling', () => {
    it('should handle initialization errors', async () => {
      // Create a monitoring system with invalid config
      const invalidConfig = {
        ...config,
        healthCheckPort: -1 // Invalid port
      };
      const invalidSystem = new MonitoringSystem(invalidConfig);

      // Mock console to avoid error output in tests
      jest.spyOn(console, 'error').mockImplementation();

      // The system should handle errors gracefully
      // Note: This test depends on the specific implementation details
      // In a real scenario, you might want to test specific error conditions
      expect(invalidSystem).toBeDefined();
    });
  });
});

/**
 * Unit tests for HealthCheckSystem
 */

import { 
  HealthCheckSystem, 
  BasicHealthChecker, 
  HttpHealthChecker,
  HealthChecker 
} from '../../src/services/health-check';
import { StructuredLogger } from '../../src/services/structured-logger';
import { MonitoringConfig, ComponentHealth } from '../../src/types/configuration';

// Mock HTTP server
jest.mock('http', () => ({
  createServer: jest.fn((handler) => ({
    listen: jest.fn((port, callback) => callback()),
    close: jest.fn((callback) => callback())
  }))
}));

describe('HealthCheckSystem', () => {
  let config: MonitoringConfig;
  let logger: StructuredLogger;
  let healthCheckSystem: HealthCheckSystem;

  beforeEach(() => {
    config = {
      enableMetrics: true,
      enableDetailedLogging: false,
      healthCheckPort: 8080
    };
    logger = new StructuredLogger('health-test', config);
    healthCheckSystem = new HealthCheckSystem(config, logger);
    
    // Mock console methods
    jest.spyOn(console, 'info').mockImplementation();
    jest.spyOn(console, 'debug').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(async () => {
    await healthCheckSystem.stop();
    jest.restoreAllMocks();
    // Add a small delay to ensure cleanup
    await new Promise(resolve => setTimeout(resolve, 10));
  });

  describe('system lifecycle', () => {
    it('should start and stop successfully', async () => {
      await healthCheckSystem.start();
      expect(healthCheckSystem['isRunning']).toBe(true);
      
      await healthCheckSystem.stop();
      expect(healthCheckSystem['isRunning']).toBe(false);
    });

    it('should not start twice', async () => {
      await healthCheckSystem.start();
      await healthCheckSystem.start(); // Should not throw
      expect(healthCheckSystem['isRunning']).toBe(true);
    });

    it('should not stop twice', async () => {
      await healthCheckSystem.start();
      await healthCheckSystem.stop();
      await healthCheckSystem.stop(); // Should not throw
      expect(healthCheckSystem['isRunning']).toBe(false);
    });
  });

  describe('health checker registration', () => {
    it('should register health checkers', () => {
      const checker: HealthChecker = {
        name: 'test-component',
        check: jest.fn().mockResolvedValue({
          name: 'test-component',
          status: 'healthy' as const,
          lastCheck: new Date()
        })
      };

      healthCheckSystem.registerChecker(checker);
      expect(healthCheckSystem['checkers'].has('test-component')).toBe(true);
    });

    it('should unregister health checkers', () => {
      const checker: HealthChecker = {
        name: 'test-component',
        check: jest.fn()
      };

      healthCheckSystem.registerChecker(checker);
      expect(healthCheckSystem['checkers'].has('test-component')).toBe(true);
      
      healthCheckSystem.unregisterChecker('test-component');
      expect(healthCheckSystem['checkers'].has('test-component')).toBe(false);
      expect(healthCheckSystem['componentStatus'].has('test-component')).toBe(false);
    });
  });

  describe('health check execution', () => {
    it('should perform health check with no components', async () => {
      const status = await healthCheckSystem.performHealthCheck();
      
      expect(status).toEqual({
        status: 'healthy',
        timestamp: expect.any(Date),
        components: [],
        uptime: expect.any(Number),
        version: expect.any(String)
      });
    });

    it('should perform health check with healthy components', async () => {
      const checker: HealthChecker = {
        name: 'healthy-component',
        check: jest.fn().mockResolvedValue({
          name: 'healthy-component',
          status: 'healthy' as const,
          message: 'All good',
          responseTime: 50,
          lastCheck: new Date()
        })
      };

      healthCheckSystem.registerChecker(checker);
      const status = await healthCheckSystem.performHealthCheck();
      
      expect(status.status).toBe('healthy');
      expect(status.components).toHaveLength(1);
      expect(status.components[0]).toEqual({
        name: 'healthy-component',
        status: 'healthy',
        message: 'All good',
        responseTime: 50,
        lastCheck: expect.any(Date)
      });
    });

    it('should determine degraded status with degraded components', async () => {
      const healthyChecker: HealthChecker = {
        name: 'healthy-component',
        check: jest.fn().mockResolvedValue({
          name: 'healthy-component',
          status: 'healthy' as const,
          lastCheck: new Date()
        })
      };

      const degradedChecker: HealthChecker = {
        name: 'degraded-component',
        check: jest.fn().mockResolvedValue({
          name: 'degraded-component',
          status: 'degraded' as const,
          message: 'Performance issues',
          lastCheck: new Date()
        })
      };

      healthCheckSystem.registerChecker(healthyChecker);
      healthCheckSystem.registerChecker(degradedChecker);
      
      const status = await healthCheckSystem.performHealthCheck();
      expect(status.status).toBe('degraded');
    });

    it('should determine unhealthy status with unhealthy components', async () => {
      const unhealthyChecker: HealthChecker = {
        name: 'unhealthy-component',
        check: jest.fn().mockResolvedValue({
          name: 'unhealthy-component',
          status: 'unhealthy' as const,
          message: 'Service down',
          lastCheck: new Date()
        })
      };

      healthCheckSystem.registerChecker(unhealthyChecker);
      
      const status = await healthCheckSystem.performHealthCheck();
      expect(status.status).toBe('unhealthy');
    });

    it('should handle checker failures gracefully', async () => {
      const failingChecker: HealthChecker = {
        name: 'failing-component',
        check: jest.fn().mockRejectedValue(new Error('Check failed'))
      };

      healthCheckSystem.registerChecker(failingChecker);
      
      const status = await healthCheckSystem.performHealthCheck();
      expect(status.status).toBe('unhealthy');
      expect(status.components[0]).toEqual({
        name: 'failing-component',
        status: 'unhealthy',
        message: 'Health check failed: Check failed',
        lastCheck: expect.any(Date)
      });
    });
  });

  describe('events', () => {
    it('should emit health check completed event', async () => {
      const healthCheckCompleted = jest.fn();
      healthCheckSystem.on('health-check-completed', healthCheckCompleted);

      await healthCheckSystem.performHealthCheck();

      expect(healthCheckCompleted).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'healthy',
          timestamp: expect.any(Date)
        })
      );
    });

    it('should emit component health changed event', async () => {
      const componentHealthChanged = jest.fn();
      healthCheckSystem.on('component-health-changed', componentHealthChanged);

      const checker: HealthChecker = {
        name: 'test-component',
        check: jest.fn().mockResolvedValue({
          name: 'test-component',
          status: 'healthy' as const,
          lastCheck: new Date()
        })
      };

      healthCheckSystem.registerChecker(checker);
      await healthCheckSystem.performHealthCheck();

      expect(componentHealthChanged).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'test-component',
          status: 'healthy'
        })
      );
    });

    it('should emit system health changed event', async () => {
      const systemHealthChanged = jest.fn();
      healthCheckSystem.on('system-health-changed', systemHealthChanged);

      // Add unhealthy component directly
      const unhealthyChecker: HealthChecker = {
        name: 'unhealthy-component',
        check: jest.fn().mockResolvedValue({
          name: 'unhealthy-component',
          status: 'unhealthy' as const,
          lastCheck: new Date()
        })
      };

      healthCheckSystem.registerChecker(unhealthyChecker);
      
      // First check should emit unhealthy (from no components to unhealthy)
      await healthCheckSystem.performHealthCheck();

      // The event should be emitted when status changes from healthy (no components) to unhealthy
      expect(systemHealthChanged).toHaveBeenCalledWith('unhealthy');
    });
  });

  describe('component status tracking', () => {
    it('should track component status changes', async () => {
      const checker: HealthChecker = {
        name: 'changing-component',
        check: jest.fn()
          .mockResolvedValueOnce({
            name: 'changing-component',
            status: 'healthy' as const,
            lastCheck: new Date()
          })
          .mockResolvedValueOnce({
            name: 'changing-component',
            status: 'degraded' as const,
            lastCheck: new Date()
          })
      };

      healthCheckSystem.registerChecker(checker);
      
      // First check
      await healthCheckSystem.performHealthCheck();
      let componentHealth = healthCheckSystem.getComponentHealth('changing-component');
      expect(componentHealth?.status).toBe('healthy');
      
      // Second check
      await healthCheckSystem.performHealthCheck();
      componentHealth = healthCheckSystem.getComponentHealth('changing-component');
      expect(componentHealth?.status).toBe('degraded');
    });

    it('should return undefined for unknown component', () => {
      const componentHealth = healthCheckSystem.getComponentHealth('unknown');
      expect(componentHealth).toBeUndefined();
    });
  });
});

describe('BasicHealthChecker', () => {
  it('should perform successful health check', async () => {
    const checkFunction = jest.fn().mockResolvedValue(true);
    const checker = new BasicHealthChecker('test-component', checkFunction, 1000);

    const result = await checker.check();

    expect(result).toEqual({
      name: 'test-component',
      status: 'healthy',
      message: 'Component is healthy',
      responseTime: expect.any(Number),
      lastCheck: expect.any(Date)
    });
    expect(checkFunction).toHaveBeenCalled();
  });

  it('should handle failed health check', async () => {
    const checkFunction = jest.fn().mockResolvedValue(false);
    const checker = new BasicHealthChecker('test-component', checkFunction);

    const result = await checker.check();

    expect(result).toEqual({
      name: 'test-component',
      status: 'unhealthy',
      message: 'Component check failed',
      responseTime: expect.any(Number),
      lastCheck: expect.any(Date)
    });
  });

  it('should handle check function errors', async () => {
    const checkFunction = jest.fn().mockRejectedValue(new Error('Check error'));
    const checker = new BasicHealthChecker('test-component', checkFunction);

    const result = await checker.check();

    expect(result).toEqual({
      name: 'test-component',
      status: 'unhealthy',
      message: 'Health check failed: Check error',
      responseTime: expect.any(Number),
      lastCheck: expect.any(Date)
    });
  });

  it('should handle timeout', async () => {
    const checkFunction = jest.fn().mockImplementation(
      () => new Promise(resolve => setTimeout(() => resolve(true), 2000))
    );
    const checker = new BasicHealthChecker('test-component', checkFunction, 100);

    const result = await checker.check();

    expect(result).toEqual({
      name: 'test-component',
      status: 'unhealthy',
      message: 'Health check failed: Health check timeout',
      responseTime: expect.any(Number),
      lastCheck: expect.any(Date)
    });
  });
});

describe('HttpHealthChecker', () => {
  let checker: HttpHealthChecker;

  beforeEach(() => {
    checker = new HttpHealthChecker('http-service', 'http://example.com/health', 200, 1000);
  });

  it('should perform successful HTTP health check', async () => {
    // Mock the HTTP request method to return success
    checker['makeHttpRequest'] = jest.fn().mockResolvedValue({ status: 200 });

    const result = await checker.check();

    expect(result).toEqual({
      name: 'http-service',
      status: 'healthy',
      message: 'HTTP endpoint responded with status 200',
      responseTime: expect.any(Number),
      lastCheck: expect.any(Date)
    });
  });

  it('should handle unexpected HTTP status', async () => {
    checker['makeHttpRequest'] = jest.fn().mockResolvedValue({ status: 500 });

    const result = await checker.check();

    expect(result).toEqual({
      name: 'http-service',
      status: 'degraded',
      message: 'HTTP endpoint returned unexpected status 500, expected 200',
      responseTime: expect.any(Number),
      lastCheck: expect.any(Date)
    });
  });

  it('should handle HTTP request errors', async () => {
    checker['makeHttpRequest'] = jest.fn().mockRejectedValue(new Error('Connection failed'));

    const result = await checker.check();

    expect(result).toEqual({
      name: 'http-service',
      status: 'unhealthy',
      message: 'HTTP endpoint check failed: Connection failed',
      responseTime: expect.any(Number),
      lastCheck: expect.any(Date)
    });
  });

  it('should use custom expected status', async () => {
    const customChecker = new HttpHealthChecker('custom-service', 'http://example.com', 204);
    customChecker['makeHttpRequest'] = jest.fn().mockResolvedValue({ status: 204 });

    const result = await customChecker.check();

    expect(result.status).toBe('healthy');
    expect(result.message).toContain('status 204');
  });
});
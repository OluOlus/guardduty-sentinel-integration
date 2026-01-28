/**
 * Health check system with detailed system status
 *
 * Provides comprehensive health monitoring for the GuardDuty to Sentinel integration,
 * including individual component health checks and HTTP endpoints for monitoring.
 */

import { EventEmitter } from 'events';
import { createServer, Server, IncomingMessage, ServerResponse, request as httpRequest } from 'http';
import { request as httpsRequest } from 'https';
import { HealthCheckStatus, ComponentHealth, MonitoringConfig } from '../types/configuration.js';
import { StructuredLogger } from './structured-logger.js';

export type { ComponentHealth, HealthCheckStatus };

export interface HealthCheckConfig {
  port?: number;
  enableEndpoint?: boolean;
  enableDetailedLogging?: boolean;
  logger?: StructuredLogger;
}

export interface HealthChecker {
  /** Component name */
  name: string;
  /** Perform health check */
  check(): Promise<ComponentHealth>;
}

export interface HealthCheckSystemEvents {
  'health-check-completed': (status: HealthCheckStatus) => void;
  'component-health-changed': (component: ComponentHealth) => void;
  'system-health-changed': (status: 'healthy' | 'degraded' | 'unhealthy') => void;
}

export declare interface HealthCheckSystem {
  on<U extends keyof HealthCheckSystemEvents>(event: U, listener: HealthCheckSystemEvents[U]): this;
  emit<U extends keyof HealthCheckSystemEvents>(
    event: U,
    ...args: Parameters<HealthCheckSystemEvents[U]>
  ): boolean;
}

export class HealthCheckSystem extends EventEmitter {
  private readonly config: MonitoringConfig;
  private readonly logger: StructuredLogger;
  private readonly checkers: Map<string, HealthChecker> = new Map();
  private readonly componentStatus: Map<string, ComponentHealth> = new Map();
  private server?: Server;
  private readonly startTime: Date = new Date();
  private checkInterval?: NodeJS.Timeout;
  private readonly checkIntervalMs: number = 30000; // 30 seconds
  private isRunning = false;
  private lastOverallStatus?: 'healthy' | 'degraded' | 'unhealthy';

  constructor(config: MonitoringConfig, logger: StructuredLogger) {
    super();
    this.config = config;
    this.logger = logger.child({ component: 'health-check' });
  }

  /**
   * Start the health check system
   */
  public async start(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    this.logger.info('Starting health check system');

    // Start HTTP server if port is configured
    if (this.config.healthCheckPort) {
      await this.startHttpServer();
    }

    // Start periodic health checks
    this.startPeriodicChecks();

    // Perform initial health check
    await this.performHealthCheck();

    this.isRunning = true;
    this.logger.info('Health check system started', {
      port: this.config.healthCheckPort,
      checkInterval: this.checkIntervalMs,
    });
  }

  /**
   * Stop the health check system
   */
  public async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.logger.info('Stopping health check system');

    // Stop periodic checks
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = undefined;
    }

    // Stop HTTP server
    if (this.server) {
      await new Promise<void>((resolve, reject) => {
        this.server!.close((error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });
      this.server = undefined;
    }

    this.isRunning = false;
    this.logger.info('Health check system stopped');
  }

  /**
   * Register a health checker
   */
  public registerChecker(checker: HealthChecker): void {
    this.checkers.set(checker.name, checker);
    this.logger.debug('Registered health checker', { component: checker.name });
  }

  /**
   * Unregister a health checker
   */
  public unregisterChecker(name: string): void {
    this.checkers.delete(name);
    this.componentStatus.delete(name);
    this.logger.debug('Unregistered health checker', { component: name });
  }

  /**
   * Perform a complete health check
   */
  public async performHealthCheck(): Promise<HealthCheckStatus> {
    const operation = this.logger.operationStart('health-check');

    try {
      const components: ComponentHealth[] = [];

      // Check all registered components
      for (const [name, checker] of this.checkers) {
        try {
          const componentHealth = await checker.check();
          components.push(componentHealth);

          // Update component status and emit event if changed
          const previousStatus = this.componentStatus.get(name);
          if (!previousStatus || previousStatus.status !== componentHealth.status) {
            this.componentStatus.set(name, componentHealth);
            this.emit('component-health-changed', componentHealth);
          }
        } catch (error) {
          const componentHealth: ComponentHealth = {
            name,
            status: 'unhealthy',
            message: `Health check failed: ${(error as Error).message}`,
            lastCheck: new Date(),
          };
          components.push(componentHealth);
          this.componentStatus.set(name, componentHealth);
          this.emit('component-health-changed', componentHealth);

          this.logger.error('Component health check failed', error as Error, { component: name });
        }
      }

      // Determine overall system health
      const overallStatus = this.determineOverallHealth(components);

      const healthStatus: HealthCheckStatus = {
        status: overallStatus,
        timestamp: new Date(),
        components,
        uptime: Math.floor((Date.now() - this.startTime.getTime()) / 1000),
        version: process.env.npm_package_version || '1.0.0',
      };

      this.emit('health-check-completed', healthStatus);

      // Emit system health change event if status changed
      if (this.lastOverallStatus !== overallStatus) {
        this.emit('system-health-changed', overallStatus);
        this.logger.info('System health status changed', {
          from: this.lastOverallStatus,
          to: overallStatus,
        });
        this.lastOverallStatus = overallStatus;
      }

      operation.success('Health check completed', {
        status: overallStatus,
        componentCount: components.length,
      });

      return healthStatus;
    } catch (error) {
      operation.failure(error as Error, 'Health check failed');
      throw error;
    }
  }

  /**
   * Get the current health status
   */
  public async getCurrentHealth(): Promise<HealthCheckStatus> {
    return this.performHealthCheck();
  }

  /**
   * Get health status for a specific component
   */
  public getComponentHealth(name: string): ComponentHealth | undefined {
    return this.componentStatus.get(name);
  }

  /**
   * Start the HTTP server for health check endpoints
   */
  private async startHttpServer(): Promise<void> {
    const port = this.config.healthCheckPort!;

    this.server = createServer((req, res) => {
      this.handleHttpRequest(req, res).catch((error) => {
        this.logger.error('Error handling health check request', error, {
          url: req.url,
          method: req.method,
        });
        this.sendErrorResponse(res, 500, 'Internal Server Error');
      });
    });

    await new Promise<void>((resolve, reject) => {
      this.server!.listen(port, (error?: Error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });

    this.logger.info('Health check HTTP server started', { port });
  }

  /**
   * Handle HTTP requests for health check endpoints
   */
  private async handleHttpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url || '';
    const method = req.method || 'GET';

    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    if (method !== 'GET') {
      this.sendErrorResponse(res, 405, 'Method Not Allowed');
      return;
    }

    try {
      switch (url) {
        case '/health':
        case '/health/':
          await this.handleHealthEndpoint(res);
          break;
        case '/health/live':
        case '/health/liveness':
          await this.handleLivenessEndpoint(res);
          break;
        case '/health/ready':
        case '/health/readiness':
          await this.handleReadinessEndpoint(res);
          break;
        default:
          this.sendErrorResponse(res, 404, 'Not Found');
      }
    } catch (error) {
      this.logger.error('Error processing health check endpoint', error as Error, { url, method });
      this.sendErrorResponse(res, 500, 'Internal Server Error');
    }
  }

  /**
   * Handle the main health endpoint
   */
  private async handleHealthEndpoint(res: ServerResponse): Promise<void> {
    const healthStatus = await this.performHealthCheck();
    const statusCode =
      healthStatus.status === 'healthy' ? 200 : healthStatus.status === 'degraded' ? 200 : 503;

    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(healthStatus, null, 2));
  }

  /**
   * Handle the liveness endpoint (basic service availability)
   */
  private async handleLivenessEndpoint(res: ServerResponse): Promise<void> {
    const response = {
      status: 'alive',
      timestamp: new Date().toISOString(),
      uptime: Math.floor((Date.now() - this.startTime.getTime()) / 1000),
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response, null, 2));
  }

  /**
   * Handle the readiness endpoint (service ready to accept traffic)
   */
  private async handleReadinessEndpoint(res: ServerResponse): Promise<void> {
    const healthStatus = await this.performHealthCheck();
    const isReady = healthStatus.status === 'healthy' || healthStatus.status === 'degraded';
    const statusCode = isReady ? 200 : 503;

    const response = {
      status: isReady ? 'ready' : 'not-ready',
      timestamp: new Date().toISOString(),
      components: healthStatus.components.map((c) => ({
        name: c.name,
        status: c.status,
        ready: c.status !== 'unhealthy',
      })),
    };

    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response, null, 2));
  }

  /**
   * Send an error response
   */
  private sendErrorResponse(res: ServerResponse, statusCode: number, message: string): void {
    const response = {
      error: message,
      timestamp: new Date().toISOString(),
    };

    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response, null, 2));
  }

  /**
   * Start periodic health checks
   */
  private startPeriodicChecks(): void {
    this.checkInterval = setInterval(() => {
      this.performHealthCheck().catch((error) => {
        this.logger.error('Periodic health check failed', error);
      });
    }, this.checkIntervalMs);
  }

  /**
   * Determine overall system health based on component health
   */
  private determineOverallHealth(
    components: ComponentHealth[]
  ): 'healthy' | 'degraded' | 'unhealthy' {
    if (components.length === 0) {
      return 'healthy'; // No components to check
    }

    const unhealthyCount = components.filter((c) => c.status === 'unhealthy').length;
    const degradedCount = components.filter((c) => c.status === 'degraded').length;

    if (unhealthyCount > 0) {
      // If any critical component is unhealthy, system is unhealthy
      return 'unhealthy';
    } else if (degradedCount > 0) {
      // If any component is degraded, system is degraded
      return 'degraded';
    } else {
      // All components are healthy
      return 'healthy';
    }
  }
}

/**
 * Legacy-compatible health check wrapper used by workers.
 */
export class HealthCheck {
  private readonly system: HealthCheckSystem;
  private readonly ownsSystem: boolean;

  constructor(config: HealthCheckConfig = {}, system?: HealthCheckSystem) {
    if (system) {
      this.system = system;
      this.ownsSystem = false;
      return;
    }

    const monitoringConfig: MonitoringConfig = {
      enableMetrics: false,
      enableDetailedLogging: config.enableDetailedLogging ?? false,
      healthCheckPort: config.enableEndpoint === false ? undefined : config.port ?? 8080,
    };

    const logger = config.logger ?? new StructuredLogger('health-check', monitoringConfig);

    this.system = new HealthCheckSystem(monitoringConfig, logger);
    this.ownsSystem = true;
  }

  public static fromSystem(system: HealthCheckSystem): HealthCheck {
    return new HealthCheck({}, system);
  }

  public async start(): Promise<void> {
    if (this.ownsSystem) {
      await this.system.start();
    }
  }

  public async stop(): Promise<void> {
    if (this.ownsSystem) {
      await this.system.stop();
    }
  }

  public registerChecker(checker: HealthChecker): void {
    this.system.registerChecker(checker);
  }

  public unregisterChecker(name: string): void {
    this.system.unregisterChecker(name);
  }

  public async getHealthStatus(): Promise<HealthCheckStatus> {
    return this.system.getCurrentHealth();
  }
}

/**
 * Basic health checker implementation
 */
export class BasicHealthChecker implements HealthChecker {
  public readonly name: string;
  private readonly checkFunction: () => Promise<boolean>;
  private readonly timeout: number;

  constructor(name: string, checkFunction: () => Promise<boolean>, timeout: number = 5000) {
    this.name = name;
    this.checkFunction = checkFunction;
    this.timeout = timeout;
  }

  public async check(): Promise<ComponentHealth> {
    const startTime = Date.now();
<<<<<<< HEAD
    let timeoutId: NodeJS.Timeout | undefined;
=======

>>>>>>> 777a7e1 (merge)
    try {
      // Run check with timeout
      const result = await Promise.race([
        this.checkFunction(),
<<<<<<< HEAD
        new Promise<boolean>((_, reject) => {
          timeoutId = setTimeout(
            () => reject(new Error('Health check timeout')),
            this.timeout
          );
        }),
=======
        new Promise<boolean>((_, reject) =>
          setTimeout(() => reject(new Error('Health check timeout')), this.timeout)
        ),
>>>>>>> 777a7e1 (merge)
      ]);

      const responseTime = Date.now() - startTime;

      return {
        name: this.name,
        status: result ? 'healthy' : 'unhealthy',
        message: result ? 'Component is healthy' : 'Component check failed',
        responseTime,
        lastCheck: new Date(),
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;

      return {
        name: this.name,
        status: 'unhealthy',
        message: `Health check failed: ${(error as Error).message}`,
        responseTime,
        lastCheck: new Date(),
      };
    }
  }
}

/**
 * HTTP endpoint health checker
 */
export class HttpHealthChecker implements HealthChecker {
  public readonly name: string;
  private readonly url: string;
  private readonly timeout: number;
  private readonly expectedStatus: number;

  constructor(name: string, url: string, expectedStatus: number = 200, timeout: number = 5000) {
    this.name = name;
    this.url = url;
    this.expectedStatus = expectedStatus;
    this.timeout = timeout;
  }

  public async check(): Promise<ComponentHealth> {
    const startTime = Date.now();

    try {
      // Simple HTTP check using fetch (if available) or http module
      const response = await this.makeHttpRequest();
      const responseTime = Date.now() - startTime;

      const isHealthy = response.status === this.expectedStatus;

      return {
        name: this.name,
        status: isHealthy ? 'healthy' : 'degraded',
        message: isHealthy
          ? `HTTP endpoint responded with status ${response.status}`
          : `HTTP endpoint returned unexpected status ${response.status}, expected ${this.expectedStatus}`,
        responseTime,
        lastCheck: new Date(),
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;

      return {
        name: this.name,
        status: 'unhealthy',
        message: `HTTP endpoint check failed: ${(error as Error).message}`,
        responseTime,
        lastCheck: new Date(),
      };
    }
  }

  private async makeHttpRequest(): Promise<{ status: number }> {
    return new Promise((resolve, reject) => {
      const targetUrl = new URL(this.url);
      const requestFn = targetUrl.protocol === 'https:' ? httpsRequest : httpRequest;
      let settled = false;
      let timeoutId: NodeJS.Timeout | undefined;
      const finalize = (action: () => void) => {
        if (settled) {
          return;
        }
        settled = true;
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        action();
      };
      const req = requestFn(targetUrl, (res) => {
        const status = res.statusCode;

        res.on('data', () => undefined);
        res.on('end', () => {
          if (typeof status !== 'number') {
            finalize(() => reject(new Error('Response missing status code')));
            return;
          }

          finalize(() => resolve({ status }));
        });
        res.on('error', (error) => {
          finalize(() => reject(error));
        });
        res.on('close', () => {
          finalize(() => reject(new Error('Response closed before completion')));
        });
      });

      timeoutId = setTimeout(() => {
        finalize(() => {
          req.destroy();
          reject(new Error('Request timeout'));
        });
      }, this.timeout);

      req.on('error', (error) => {
        finalize(() => reject(error));
      });

      req.end();
    });
  }
}

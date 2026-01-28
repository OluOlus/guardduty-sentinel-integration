/**
 * Structured logging system with contextual error information
 *
 * Provides comprehensive logging capabilities for the GuardDuty to Sentinel integration,
 * with structured output, contextual information, and configurable log levels.
 */

import { EventEmitter } from 'events';
import { MonitoringConfig } from '../types/configuration.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface LogEntry {
  /** Log level */
  level: LogLevel;
  /** Log message */
  message: string;
  /** Timestamp */
  timestamp: Date;
  /** Logger name/component */
  logger: string;
  /** Contextual data */
  context?: Record<string, unknown>;
  /** Error information */
  error?: ErrorInfo;
  /** Correlation ID for request tracing */
  correlationId?: string;
  /** Operation name */
  operation?: string;
  /** Duration in milliseconds (for operation timing) */
  duration?: number;
}

export interface ErrorInfo {
  /** Error name */
  name: string;
  /** Error message */
  message: string;
  /** Error stack trace */
  stack?: string;
  /** Error code */
  code?: string;
  /** Additional error details */
  details?: Record<string, unknown>;
  /** Inner/cause error */
  cause?: ErrorInfo;
}

export interface LoggerContext {
  /** Component or service name */
  component?: string;
  /** Operation being performed */
  operation?: string;
  /** Correlation ID for request tracing */
  correlationId?: string;
  /** Additional context data */
  data?: Record<string, unknown>;
}

export interface StructuredLoggerEvents {
  'log-entry': (entry: LogEntry) => void;
  'error-logged': (entry: LogEntry) => void;
  'fatal-logged': (entry: LogEntry) => void;
}

export declare interface StructuredLogger {
  on<U extends keyof StructuredLoggerEvents>(event: U, listener: StructuredLoggerEvents[U]): this;
  emit<U extends keyof StructuredLoggerEvents>(
    event: U,
    ...args: Parameters<StructuredLoggerEvents[U]>
  ): boolean;
}

export class StructuredLogger extends EventEmitter {
  private readonly config: MonitoringConfig;
  private readonly loggerName: string;
  private readonly context: LoggerContext;
  private readonly minLevel: LogLevel;
  private readonly levelPriority: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
    fatal: 4,
  };

  constructor(loggerName: string, config: MonitoringConfig, context: LoggerContext = {}) {
    super();
    this.loggerName = loggerName;
    this.config = config;
    this.context = context;
    this.minLevel = config.enableDetailedLogging ? 'debug' : 'info';
  }

  /**
   * Create a child logger with additional context
   */
  public child(context: LoggerContext): StructuredLogger {
    const mergedContext = {
      ...this.context,
      ...context,
      data: {
        ...this.context.data,
        ...context.data,
      },
    };
    return new StructuredLogger(this.loggerName, this.config, mergedContext);
  }

  /**
   * Log a debug message
   */
  public debug(message: string, context?: Record<string, unknown>): void {
    this.log('debug', message, context);
  }

  /**
   * Log an info message
   */
  public info(message: string, context?: Record<string, unknown>): void {
    this.log('info', message, context);
  }

  /**
   * Log a warning message
   */
  public warn(message: string, context?: Record<string, unknown>): void {
    this.log('warn', message, context);
  }

  /**
   * Log an error message
   */
  public error(message: string, error?: Error, context?: Record<string, unknown>): void {
    this.log('error', message, context, error);
  }

  /**
   * Log a fatal error message
   */
  public fatal(message: string, error?: Error, context?: Record<string, unknown>): void {
    this.log('fatal', message, context, error);
  }

  /**
   * Log the start of an operation
   */
  public operationStart(operation: string, context?: Record<string, unknown>): OperationLogger {
    const correlationId = this.generateCorrelationId();
    const operationContext = {
      ...this.context,
      operation,
      correlationId,
      data: {
        ...this.context.data,
        ...context,
      },
    };

    // Create a child logger with operation context and log the start
    const operationLogger = this.child(operationContext);
    operationLogger.info(`Starting operation: ${operation}`, context);

    return new OperationLogger(this, operation, correlationId, Date.now());
  }

  /**
   * Log with timing information
   */
  public timed<T>(operation: string, fn: () => T, context?: Record<string, unknown>): T;
  public timed<T>(
    operation: string,
    fn: () => Promise<T>,
    context?: Record<string, unknown>
  ): Promise<T>;
  public timed<T>(
    operation: string,
    fn: () => T | Promise<T>,
    context?: Record<string, unknown>
  ): T | Promise<T> {
    const startTime = Date.now();
    const correlationId = this.generateCorrelationId();

    // Create a child logger with timing context
    const timedLogger = this.child({
      operation,
      correlationId,
      data: context,
    });

    timedLogger.debug(`Starting timed operation: ${operation}`, context);

    try {
      const result = fn();

      if (result instanceof Promise) {
        return result
          .then((value) => {
            const duration = Date.now() - startTime;
            timedLogger.debug(`Completed timed operation: ${operation}`, { ...context, duration });
            return value;
          })
          .catch((error) => {
            const duration = Date.now() - startTime;
            timedLogger.error(`Failed timed operation: ${operation}`, error, {
              ...context,
              duration,
            });
            throw error;
          });
      } else {
        const duration = Date.now() - startTime;
        timedLogger.debug(`Completed timed operation: ${operation}`, { ...context, duration });
        return result;
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      timedLogger.error(`Failed timed operation: ${operation}`, error as Error, {
        ...context,
        duration,
      });
      throw error;
    }
  }

  /**
   * Core logging method
   */
  private log(
    level: LogLevel,
    message: string,
    context?: Record<string, unknown>,
    error?: Error,
    correlationId?: string,
    operation?: string,
    duration?: number
  ): void {
    // Check if log level meets minimum threshold
    if (this.levelPriority[level] < this.levelPriority[this.minLevel]) {
      return;
    }

    const entry: LogEntry = {
      level,
      message,
      timestamp: new Date(),
      logger: this.loggerName,
      context: {
        ...this.context.data,
        ...context,
      },
      correlationId: correlationId || this.context.correlationId,
      operation: operation || this.context.operation,
      duration,
    };

    if (error) {
      entry.error = this.serializeError(error);
    }

    // Emit events
    this.emit('log-entry', entry);
    if (level === 'error') {
      this.emit('error-logged', entry);
    } else if (level === 'fatal') {
      this.emit('fatal-logged', entry);
    }

    // Output to console (can be replaced with other transports)
    this.outputToConsole(entry);
  }

  /**
   * Serialize error information
   */
  private serializeError(error: Error): ErrorInfo {
    const errorInfo: ErrorInfo = {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };

    // Add error code if available
    if ('code' in error && typeof error.code === 'string') {
      errorInfo.code = error.code;
    }

    // Add additional error details
    const details: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(error)) {
      if (key !== 'name' && key !== 'message' && key !== 'stack' && key !== 'code') {
        details[key] = value;
      }
    }
    if (Object.keys(details).length > 0) {
      errorInfo.details = details;
    }

    // Handle nested/cause errors
    if ('cause' in error && error.cause instanceof Error) {
      errorInfo.cause = this.serializeError(error.cause);
    }

    return errorInfo;
  }

  /**
   * Output log entry to console
   */
  private outputToConsole(entry: LogEntry): void {
    const timestamp = entry.timestamp.toISOString();
    const level = entry.level.toUpperCase().padEnd(5);
    const logger = entry.logger.padEnd(20);

    let output = `${timestamp} [${level}] ${logger} - ${entry.message}`;

    // Add correlation ID if present
    if (entry.correlationId) {
      output += ` [${entry.correlationId}]`;
    }

    // Add operation if present
    if (entry.operation) {
      output += ` (${entry.operation})`;
    }

    // Add duration if present
    if (entry.duration !== undefined) {
      output += ` [${entry.duration}ms]`;
    }

    // Add context if present and detailed logging is enabled
    if (
      entry.context &&
      Object.keys(entry.context).length > 0 &&
      this.config.enableDetailedLogging
    ) {
      output += `\n  Context: ${JSON.stringify(entry.context, null, 2)}`;
    }

    // Add error information if present
    if (entry.error) {
      output += `\n  Error: ${entry.error.name}: ${entry.error.message}`;
      if (entry.error.code) {
        output += ` (${entry.error.code})`;
      }
      if (entry.error.stack && this.config.enableDetailedLogging) {
        output += `\n  Stack: ${entry.error.stack}`;
      }
      if (entry.error.details && Object.keys(entry.error.details).length > 0) {
        output += `\n  Details: ${JSON.stringify(entry.error.details, null, 2)}`;
      }
      if (entry.error.cause) {
        output += `\n  Caused by: ${entry.error.cause.name}: ${entry.error.cause.message}`;
      }
    }

    // Use appropriate console method based on log level
    switch (entry.level) {
      case 'debug':
        console.debug(output);
        break;
      case 'info':
        console.info(output);
        break;
      case 'warn':
        console.warn(output);
        break;
      case 'error':
      case 'fatal':
        console.error(output);
        break;
    }
  }

  /**
   * Generate a correlation ID for request tracing
   */
  private generateCorrelationId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

/**
 * Operation logger for tracking operation lifecycle
 */
export class OperationLogger {
  private readonly logger: StructuredLogger;
  private readonly operation: string;
  private readonly correlationId: string;
  private readonly startTime: number;

  constructor(
    logger: StructuredLogger,
    operation: string,
    correlationId: string,
    startTime: number
  ) {
    this.logger = logger;
    this.operation = operation;
    this.correlationId = correlationId;
    this.startTime = startTime;
  }

  /**
   * Log operation success
   */
  public success(message?: string, context?: Record<string, unknown>): void {
    const duration = Date.now() - this.startTime;
    const finalMessage = message || `Operation completed successfully: ${this.operation}`;

    // Create a child logger with operation context and log the success
    const operationLogger = this.logger.child({
      operation: this.operation,
      correlationId: this.correlationId,
    });

    operationLogger.info(finalMessage, { ...context, duration });
  }

  /**
   * Log operation failure
   */
  public failure(error: Error, message?: string, context?: Record<string, unknown>): void {
    const duration = Date.now() - this.startTime;
    const finalMessage = message || `Operation failed: ${this.operation}`;

    // Create a child logger with operation context and log the failure
    const operationLogger = this.logger.child({
      operation: this.operation,
      correlationId: this.correlationId,
    });

    operationLogger.error(finalMessage, error, { ...context, duration });
  }

  /**
   * Log operation progress
   */
  public progress(message: string, context?: Record<string, unknown>): void {
    const duration = Date.now() - this.startTime;

    // Create a child logger with operation context and log the progress
    const operationLogger = this.logger.child({
      operation: this.operation,
      correlationId: this.correlationId,
    });

    operationLogger.debug(`${this.operation}: ${message}`, { ...context, duration });
  }

  /**
   * Get operation context for child loggers
   */
  public getContext(): LoggerContext {
    return {
      operation: this.operation,
      correlationId: this.correlationId,
    };
  }
}

/**
 * Logger factory for creating structured loggers
 */
export class LoggerFactory {
  private static config: MonitoringConfig;
  private static loggers: Map<string, StructuredLogger> = new Map();

  /**
   * Initialize the logger factory with configuration
   */
  public static initialize(config: MonitoringConfig): void {
    this.config = config;
  }

  /**
   * Get or create a logger for the specified name
   */
  public static getLogger(name: string, context?: LoggerContext): StructuredLogger {
    if (!this.config) {
      throw new Error('LoggerFactory not initialized. Call initialize() first.');
    }

    const key = `${name}:${JSON.stringify(context || {})}`;

    if (!this.loggers.has(key)) {
      const logger = new StructuredLogger(name, this.config, context);
      this.loggers.set(key, logger);
    }

    return this.loggers.get(key)!;
  }

  /**
   * Clear all cached loggers
   */
  public static clear(): void {
    this.loggers.clear();
  }
}

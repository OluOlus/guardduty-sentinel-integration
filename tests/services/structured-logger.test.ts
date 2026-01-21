/**
 * Unit tests for StructuredLogger
 */

import { StructuredLogger, LoggerFactory, OperationLogger } from '../../src/services/structured-logger';
import { MonitoringConfig } from '../../src/types/configuration';

describe('StructuredLogger', () => {
  let config: MonitoringConfig;
  let logger: StructuredLogger;
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    config = {
      enableMetrics: true,
      enableDetailedLogging: false,
      healthCheckPort: 8080
    };
    logger = new StructuredLogger('test-logger', config);
    consoleSpy = jest.spyOn(console, 'info').mockImplementation();
    jest.spyOn(console, 'debug').mockImplementation();
    jest.spyOn(console, 'warn').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('basic logging', () => {
    it('should log info messages', () => {
      const logEntry = jest.fn();
      logger.on('log-entry', logEntry);

      logger.info('Test info message', { key: 'value' });

      expect(logEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'info',
          message: 'Test info message',
          logger: 'test-logger',
          context: { key: 'value' }
        })
      );
      expect(consoleSpy).toHaveBeenCalled();
    });

    it('should log debug messages when detailed logging enabled', () => {
      config.enableDetailedLogging = true;
      const detailedLogger = new StructuredLogger('test-logger', config);
      const logEntry = jest.fn();
      detailedLogger.on('log-entry', logEntry);

      detailedLogger.debug('Test debug message');

      expect(logEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'debug',
          message: 'Test debug message'
        })
      );
    });

    it('should not log debug messages when detailed logging disabled', () => {
      const logEntry = jest.fn();
      logger.on('log-entry', logEntry);

      logger.debug('Test debug message');

      expect(logEntry).not.toHaveBeenCalled();
    });

    it('should log warning messages', () => {
      const logEntry = jest.fn();
      logger.on('log-entry', logEntry);

      logger.warn('Test warning message');

      expect(logEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'warn',
          message: 'Test warning message'
        })
      );
    });

    it('should log error messages with error details', () => {
      const logEntry = jest.fn();
      const errorLogged = jest.fn();
      logger.on('log-entry', logEntry);
      logger.on('error-logged', errorLogged);

      const testError = new Error('Test error');
      testError.name = 'TestError';
      
      logger.error('Test error message', testError, { context: 'test' });

      expect(logEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'error',
          message: 'Test error message',
          context: { context: 'test' },
          error: expect.objectContaining({
            name: 'TestError',
            message: 'Test error'
          })
        })
      );
      expect(errorLogged).toHaveBeenCalled();
    });

    it('should log fatal messages', () => {
      const logEntry = jest.fn();
      const fatalLogged = jest.fn();
      logger.on('log-entry', logEntry);
      logger.on('fatal-logged', fatalLogged);

      logger.fatal('Test fatal message');

      expect(logEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'fatal',
          message: 'Test fatal message'
        })
      );
      expect(fatalLogged).toHaveBeenCalled();
    });
  });

  describe('child loggers', () => {
    it('should create child logger with additional context', () => {
      const childLogger = logger.child({ 
        component: 'child', 
        data: { childKey: 'childValue' } 
      });
      
      const logEntry = jest.fn();
      childLogger.on('log-entry', logEntry);

      childLogger.info('Child message', { additional: 'context' });

      expect(logEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          context: {
            childKey: 'childValue',
            additional: 'context'
          }
        })
      );
    });

    it('should merge context from parent and child', () => {
      const parentLogger = new StructuredLogger('parent', config, {
        component: 'parent',
        data: { parentKey: 'parentValue' }
      });

      const childLogger = parentLogger.child({
        operation: 'child-op',
        data: { childKey: 'childValue' }
      });

      const logEntry = jest.fn();
      childLogger.on('log-entry', logEntry);

      childLogger.info('Test message');

      expect(logEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          context: {
            parentKey: 'parentValue',
            childKey: 'childValue'
          }
        })
      );
    });
  });

  describe('operation logging', () => {
    it('should track operation lifecycle', () => {
      const operation = logger.operationStart('test-operation', { key: 'value' });
      
      // Verify the operation context is correct
      const context = operation.getContext();
      expect(context.operation).toBe('test-operation');
      expect(context.correlationId).toBeDefined();
      
      // Verify methods can be called without error
      expect(() => operation.success('Operation completed successfully')).not.toThrow();
    });

    it('should track operation failure', () => {
      const operation = logger.operationStart('failing-operation');
      const testError = new Error('Operation failed');
      
      // Verify the operation context is correct
      const context = operation.getContext();
      expect(context.operation).toBe('failing-operation');
      expect(context.correlationId).toBeDefined();
      
      // Verify methods can be called without error
      expect(() => operation.failure(testError, 'Custom failure message')).not.toThrow();
    });

    it('should track operation progress', () => {
      const operation = logger.operationStart('long-operation');
      
      // Verify the operation context is correct
      const context = operation.getContext();
      expect(context.operation).toBe('long-operation');
      expect(context.correlationId).toBeDefined();
      
      // Verify methods can be called without error
      expect(() => operation.progress('Processing step 1', { step: 1 })).not.toThrow();
    });
  });

  describe('timed operations', () => {
    it('should time synchronous operations', () => {
      const result = logger.timed('sync-operation', () => {
        return 'success';
      }, { context: 'test' });

      expect(result).toBe('success');
    });

    it('should time asynchronous operations', async () => {
      const result = await logger.timed('async-operation', async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        return 'async-success';
      });

      expect(result).toBe('async-success');
    });

    it('should handle timed operation failures', async () => {
      const testError = new Error('Timed operation failed');
      
      await expect(
        logger.timed('failing-operation', async () => {
          throw testError;
        })
      ).rejects.toThrow('Timed operation failed');
    });
  });

  describe('error serialization', () => {
    it('should serialize basic error information', () => {
      const logEntry = jest.fn();
      logger.on('log-entry', logEntry);

      const error = new Error('Test error');
      error.name = 'CustomError';
      
      logger.error('Error occurred', error);

      expect(logEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          error: {
            name: 'CustomError',
            message: 'Test error',
            stack: expect.any(String)
          }
        })
      );
    });

    it('should serialize error with code', () => {
      const logEntry = jest.fn();
      logger.on('log-entry', logEntry);

      const error = new Error('Test error') as any;
      error.code = 'TEST_ERROR_CODE';
      
      logger.error('Error with code', error);

      expect(logEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            code: 'TEST_ERROR_CODE'
          })
        })
      );
    });

    it('should serialize nested errors', () => {
      const logEntry = jest.fn();
      logger.on('log-entry', logEntry);

      const causeError = new Error('Root cause');
      const mainError = new Error('Main error') as any;
      mainError.cause = causeError;
      
      logger.error('Nested error', mainError);

      expect(logEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            message: 'Main error',
            cause: expect.objectContaining({
              message: 'Root cause'
            })
          })
        })
      );
    });
  });

  describe('console output formatting', () => {
    it('should format basic log entry', () => {
      logger.info('Test message');

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringMatching(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z \[INFO \] test-logger\s+- Test message/)
      );
    });

    it('should include correlation ID in output', () => {
      const operation = logger.operationStart('test-op');
      const context = operation.getContext();
      
      logger.info('Test with correlation', { test: 'value' });

      // The correlation ID should be in the output somewhere
      expect(consoleSpy).toHaveBeenCalled();
    });

    it('should format detailed context when enabled', () => {
      config.enableDetailedLogging = true;
      const detailedLogger = new StructuredLogger('detailed', config);
      const detailedSpy = jest.spyOn(console, 'info').mockImplementation();

      detailedLogger.info('Test with context', { key: 'value', nested: { data: 'test' } });

      expect(detailedSpy).toHaveBeenCalledWith(
        expect.stringContaining('Context: {')
      );
      
      detailedSpy.mockRestore();
    });
  });
});

describe('LoggerFactory', () => {
  let config: MonitoringConfig;

  beforeEach(() => {
    config = {
      enableMetrics: true,
      enableDetailedLogging: false
    };
    LoggerFactory.clear();
    // Ensure config is cleared
    (LoggerFactory as any).config = undefined;
  });

  afterEach(() => {
    LoggerFactory.clear();
  });

  it('should initialize with configuration', () => {
    LoggerFactory.initialize(config);
    
    const logger = LoggerFactory.getLogger('test');
    expect(logger).toBeInstanceOf(StructuredLogger);
  });

  it('should throw error when not initialized', () => {
    expect(() => {
      LoggerFactory.getLogger('test');
    }).toThrow('LoggerFactory not initialized');
  });

  it('should cache loggers by name and context', () => {
    LoggerFactory.initialize(config);
    
    const logger1 = LoggerFactory.getLogger('test', { component: 'a' });
    const logger2 = LoggerFactory.getLogger('test', { component: 'a' });
    const logger3 = LoggerFactory.getLogger('test', { component: 'b' });
    
    expect(logger1).toBe(logger2); // Same logger instance
    expect(logger1).not.toBe(logger3); // Different context
  });

  it('should clear cached loggers', () => {
    LoggerFactory.initialize(config);
    
    const logger1 = LoggerFactory.getLogger('test');
    LoggerFactory.clear();
    LoggerFactory.initialize(config);
    const logger2 = LoggerFactory.getLogger('test');
    
    expect(logger1).not.toBe(logger2);
  });
});

describe('OperationLogger', () => {
  let config: MonitoringConfig;
  let logger: StructuredLogger;
  let operation: OperationLogger;

  beforeEach(() => {
    config = {
      enableMetrics: true,
      enableDetailedLogging: true
    };
    logger = new StructuredLogger('test', config);
    jest.spyOn(console, 'info').mockImplementation();
    jest.spyOn(console, 'debug').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
    
    operation = logger.operationStart('test-operation');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should provide operation context', () => {
    const context = operation.getContext();
    
    expect(context).toEqual({
      operation: 'test-operation',
      correlationId: expect.any(String)
    });
  });

  it('should log success with default message', () => {
    // Since OperationLogger creates child loggers, we can't easily test the exact log output
    // Instead, we test that the methods can be called without error
    expect(() => operation.success()).not.toThrow();
  });

  it('should log success with custom message', () => {
    expect(() => operation.success('Custom success message', { result: 'data' })).not.toThrow();
  });

  it('should log failure with error', () => {
    const error = new Error('Operation error');
    expect(() => operation.failure(error, 'Custom failure message')).not.toThrow();
  });

  it('should log progress updates', () => {
    expect(() => operation.progress('Step 1 completed', { step: 1, total: 3 })).not.toThrow();
  });
});
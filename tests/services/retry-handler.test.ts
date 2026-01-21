/**
 * Unit tests for RetryHandler
 */

import { RetryHandler, InMemoryDeadLetterQueue } from '../../src/services/retry-handler';
import { RetryPolicy } from '../../src/types/configuration';

describe('RetryHandler', () => {
  let retryPolicy: RetryPolicy;
  let retryHandler: RetryHandler;
  let deadLetterQueue: InMemoryDeadLetterQueue;

  beforeEach(() => {
    retryPolicy = {
      maxRetries: 3,
      initialBackoffMs: 100,
      maxBackoffMs: 5000,
      backoffMultiplier: 2,
      enableJitter: false, // Disable for predictable testing
      retryableErrors: ['NETWORK_ERROR', 'TIMEOUT', '500']
    };
    deadLetterQueue = new InMemoryDeadLetterQueue();
    retryHandler = new RetryHandler(retryPolicy, deadLetterQueue);
  });

  describe('Successful Operations', () => {
    it('should execute operation successfully on first attempt', async () => {
      const mockOperation = jest.fn().mockResolvedValue('success');
      
      const result = await retryHandler.executeWithRetry(mockOperation);
      
      expect(result).toBe('success');
      expect(mockOperation).toHaveBeenCalledTimes(1);
    });

    it('should not retry non-retryable errors', async () => {
      const error = new Error('Non-retryable error');
      (error as any).code = 'INVALID_INPUT';
      const mockOperation = jest.fn().mockRejectedValue(error);
      
      await expect(retryHandler.executeWithRetry(mockOperation)).rejects.toThrow('Non-retryable error');
      expect(mockOperation).toHaveBeenCalledTimes(1);
    });
  });

  describe('Retry Logic', () => {
    it('should retry retryable errors up to maxRetries', async () => {
      const error = new Error('Network error');
      (error as any).code = 'NETWORK_ERROR';
      const mockOperation = jest.fn().mockRejectedValue(error);
      
      await expect(retryHandler.executeWithRetry(mockOperation)).rejects.toThrow('Network error');
      expect(mockOperation).toHaveBeenCalledTimes(4); // Initial + 3 retries
    });

    it('should succeed after retries', async () => {
      const error = new Error('Temporary error');
      (error as any).code = 'TIMEOUT';
      const mockOperation = jest.fn()
        .mockRejectedValueOnce(error)
        .mockRejectedValueOnce(error)
        .mockResolvedValue('success');
      
      const result = await retryHandler.executeWithRetry(mockOperation);
      
      expect(result).toBe('success');
      expect(mockOperation).toHaveBeenCalledTimes(3);
    });

    it('should emit retry-attempt events', async () => {
      const error = new Error('Retryable error');
      (error as any).code = '500';
      const mockOperation = jest.fn().mockRejectedValue(error);
      
      const retryAttempts: number[] = [];
      retryHandler.on('retry-attempt', (attempt) => {
        retryAttempts.push(attempt);
      });
      
      await expect(retryHandler.executeWithRetry(mockOperation)).rejects.toThrow();
      expect(retryAttempts).toEqual([1, 2, 3]);
    });

    it('should emit retry-exhausted event', async () => {
      const error = new Error('Persistent error');
      (error as any).code = 'NETWORK_ERROR';
      const mockOperation = jest.fn().mockRejectedValue(error);
      
      let exhaustedEvent = false;
      retryHandler.on('retry-exhausted', () => {
        exhaustedEvent = true;
      });
      
      await expect(retryHandler.executeWithRetry(mockOperation)).rejects.toThrow();
      expect(exhaustedEvent).toBe(true);
    });
  });
  describe('Backoff Calculation', () => {
    it('should calculate exponential backoff correctly', async () => {
      const error = new Error('Test error');
      (error as any).code = 'TIMEOUT';
      const mockOperation = jest.fn().mockRejectedValue(error);
      
      const delays: number[] = [];
      retryHandler.on('retry-attempt', (attempt, error, delayMs) => {
        delays.push(delayMs);
      });
      
      await expect(retryHandler.executeWithRetry(mockOperation)).rejects.toThrow();
      
      // Expected delays: 100, 200, 400 (exponential backoff with multiplier 2)
      expect(delays[0]).toBe(100);
      expect(delays[1]).toBe(200);
      expect(delays[2]).toBe(400);
    });

    it('should respect maximum backoff limit', async () => {
      const shortMaxPolicy: RetryPolicy = {
        ...retryPolicy,
        maxBackoffMs: 150,
        maxRetries: 5
      };
      const handler = new RetryHandler(shortMaxPolicy);
      
      const error = new Error('Test error');
      (error as any).code = 'TIMEOUT';
      const mockOperation = jest.fn().mockRejectedValue(error);
      
      const delays: number[] = [];
      handler.on('retry-attempt', (attempt, error, delayMs) => {
        delays.push(delayMs);
      });
      
      await expect(handler.executeWithRetry(mockOperation)).rejects.toThrow();
      
      // All delays should be capped at maxBackoffMs
      delays.forEach(delay => {
        expect(delay).toBeLessThanOrEqual(150);
      });
    });
  });

  describe('Dead Letter Queue Integration', () => {
    it('should send to DLQ when retries are exhausted', async () => {
      const error = new Error('Persistent error');
      (error as any).code = 'NETWORK_ERROR';
      const mockOperation = jest.fn().mockRejectedValue(error);
      const testItem = { id: 'test-item' };
      
      let dlqEvent = false;
      retryHandler.on('dead-letter-queued', () => {
        dlqEvent = true;
      });
      
      const result = await retryHandler.executeWithRetryAndDLQ(mockOperation, testItem);
      
      expect(result).toBeNull(); // Indicates item was sent to DLQ
      expect(dlqEvent).toBe(true);
      expect(deadLetterQueue.getSize()).toBe(1);
    });

    it('should return result when operation succeeds', async () => {
      const mockOperation = jest.fn().mockResolvedValue('success');
      const testItem = { id: 'test-item' };
      
      const result = await retryHandler.executeWithRetryAndDLQ(mockOperation, testItem);
      
      expect(result).toBe('success');
      expect(deadLetterQueue.getSize()).toBe(0);
    });
  });

  describe('Error Classification', () => {
    it('should identify retryable errors by code', async () => {
      const error = new Error('Server error');
      (error as any).code = '500';
      const mockOperation = jest.fn().mockRejectedValue(error);
      
      await expect(retryHandler.executeWithRetry(mockOperation)).rejects.toThrow();
      expect(mockOperation).toHaveBeenCalledTimes(4); // Retried
    });

    it('should identify retryable errors by message', async () => {
      const error = new Error('TIMEOUT occurred');
      const mockOperation = jest.fn().mockRejectedValue(error);
      
      await expect(retryHandler.executeWithRetry(mockOperation)).rejects.toThrow();
      expect(mockOperation).toHaveBeenCalledTimes(4); // Retried
    });

    it('should not retry non-matching errors', async () => {
      const error = new Error('Validation failed');
      (error as any).code = 'VALIDATION_ERROR';
      const mockOperation = jest.fn().mockRejectedValue(error);
      
      await expect(retryHandler.executeWithRetry(mockOperation)).rejects.toThrow();
      expect(mockOperation).toHaveBeenCalledTimes(1); // Not retried
    });
  });
  describe('Policy Factory Methods', () => {
    it('should create default policy', () => {
      const policy = RetryHandler.createDefaultPolicy();
      
      expect(policy.maxRetries).toBe(3);
      expect(policy.initialBackoffMs).toBe(1000);
      expect(policy.enableJitter).toBe(true);
      expect(policy.retryableErrors).toContain('ECONNRESET');
      expect(policy.retryableErrors).toContain('500');
    });

    it('should create AWS-specific policy', () => {
      const policy = RetryHandler.createAwsPolicy();
      
      expect(policy.maxRetries).toBe(5);
      expect(policy.retryableErrors).toContain('ThrottlingException');
      expect(policy.retryableErrors).toContain('ServiceUnavailable');
    });

    it('should create Azure-specific policy', () => {
      const policy = RetryHandler.createAzurePolicy();
      
      expect(policy.maxRetries).toBe(4);
      expect(policy.backoffMultiplier).toBe(2.5);
      expect(policy.retryableErrors).toContain('TooManyRequests');
      expect(policy.retryableErrors).toContain('429');
    });
  });
});

describe('InMemoryDeadLetterQueue', () => {
  let dlq: InMemoryDeadLetterQueue;

  beforeEach(() => {
    dlq = new InMemoryDeadLetterQueue();
  });

  it('should send items to queue', async () => {
    const item = { id: 'test-item' };
    const error = new Error('Test error');
    
    await dlq.send(item, error, 'test-context');
    
    expect(dlq.getSize()).toBe(1);
    
    const items = await dlq.receive();
    expect(items).toHaveLength(1);
    expect(items[0].item).toEqual(item);
    expect(items[0].context).toBe('test-context');
  });

  it('should delete items from queue', async () => {
    const item = { id: 'test-item' };
    const error = new Error('Test error');
    
    await dlq.send(item, error);
    const items = await dlq.receive();
    const itemId = items[0].id;
    
    await dlq.delete(itemId);
    
    expect(dlq.getSize()).toBe(0);
  });

  it('should limit received items', async () => {
    // Send multiple items
    for (let i = 0; i < 5; i++) {
      await dlq.send({ id: `item-${i}` }, new Error('Test error'));
    }
    
    const items = await dlq.receive(3);
    expect(items).toHaveLength(3);
  });

  it('should clear all items', async () => {
    await dlq.send({ id: 'item-1' }, new Error('Test error'));
    await dlq.send({ id: 'item-2' }, new Error('Test error'));
    
    expect(dlq.getSize()).toBe(2);
    
    dlq.clear();
    
    expect(dlq.getSize()).toBe(0);
  });
});
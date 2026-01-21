/**
 * Retry handler with exponential backoff and jitter
 * Provides configurable retry policies and dead letter queue integration
 */

import { EventEmitter } from 'events';
import { RetryPolicy, ProcessingError } from '../types/configuration';

export interface RetryHandlerEvents {
  'retry-attempt': (attempt: number, error: Error, nextDelayMs: number) => void;
  'retry-exhausted': (error: Error, attempts: number) => void;
  'dead-letter-queued': (item: unknown, error: Error) => void;
}

export declare interface RetryHandler {
  on<U extends keyof RetryHandlerEvents>(
    event: U, 
    listener: RetryHandlerEvents[U]
  ): this;
  emit<U extends keyof RetryHandlerEvents>(
    event: U, 
    ...args: Parameters<RetryHandlerEvents[U]>
  ): boolean;
}

/**
 * RetryHandler manages retry logic with exponential backoff and jitter
 * to prevent thundering herd problems and handle transient failures gracefully
 */
export class RetryHandler extends EventEmitter {
  private readonly policy: RetryPolicy;
  private readonly deadLetterQueue?: DeadLetterQueue;

  constructor(policy: RetryPolicy, deadLetterQueue?: DeadLetterQueue) {
    super();
    this.policy = policy;
    this.deadLetterQueue = deadLetterQueue;
  }

  /**
   * Execute an operation with retry logic
   */
  public async executeWithRetry<T>(
    operation: () => Promise<T>,
    context?: string
  ): Promise<T> {
    let lastError: Error;
    
    for (let attempt = 0; attempt <= this.policy.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;
        
        // Check if error is retryable
        if (!this.isRetryableError(lastError)) {
          throw lastError;
        }
        
        // If this was the last attempt, don't retry
        if (attempt === this.policy.maxRetries) {
          break;
        }
        
        // Calculate delay for next attempt
        const delayMs = this.calculateBackoffDelay(attempt);
        
        this.emit('retry-attempt', attempt + 1, lastError, delayMs);
        
        // Wait before retrying
        await this.sleep(delayMs);
      }
    }
    
    // All retries exhausted
    this.emit('retry-exhausted', lastError!, this.policy.maxRetries + 1);
    throw lastError!;
  }
  /**
   * Execute an operation with retry logic and dead letter queue fallback
   */
  public async executeWithRetryAndDLQ<T>(
    operation: () => Promise<T>,
    item: unknown,
    context?: string
  ): Promise<T | null> {
    try {
      return await this.executeWithRetry(operation, context);
    } catch (error) {
      // Send to dead letter queue if available
      if (this.deadLetterQueue) {
        await this.deadLetterQueue.send(item, error as Error, context);
        this.emit('dead-letter-queued', item, error as Error);
        return null; // Indicate item was sent to DLQ
      }
      
      // Re-throw if no DLQ available
      throw error;
    }
  }

  /**
   * Calculate exponential backoff delay with jitter
   */
  private calculateBackoffDelay(attempt: number): number {
    // Exponential backoff: initialDelay * (multiplier ^ attempt)
    let delay = this.policy.initialBackoffMs * Math.pow(this.policy.backoffMultiplier, attempt);
    
    // Cap at maximum backoff
    delay = Math.min(delay, this.policy.maxBackoffMs);
    
    // Add jitter to prevent thundering herd
    if (this.policy.enableJitter) {
      // Add random jitter of ±25% of the delay
      const jitterRange = delay * 0.25;
      const jitter = (Math.random() - 0.5) * 2 * jitterRange;
      delay += jitter;
    }
    
    // Ensure delay is not negative
    return Math.max(delay, 0);
  }

  /**
   * Check if an error is retryable based on policy configuration
   */
  private isRetryableError(error: Error): boolean {
    // If no specific retryable errors configured, retry all errors
    if (this.policy.retryableErrors.length === 0) {
      return true;
    }
    
    // Check if error code/message matches retryable patterns
    const errorCode = (error as any).code || error.name || 'UNKNOWN_ERROR';
    const errorMessage = error.message || '';
    
    return this.policy.retryableErrors.some(pattern => {
      // Skip empty or whitespace-only patterns
      if (!pattern || pattern.trim().length === 0) {
        return false;
      }
      
      // Support both exact matches and regex patterns
      if (pattern.startsWith('/') && pattern.endsWith('/')) {
        // Regex pattern
        const regex = new RegExp(pattern.slice(1, -1), 'i');
        return regex.test(errorCode) || regex.test(errorMessage);
      } else {
        // Exact match for error codes, substring match for meaningful error messages
        return errorCode.toLowerCase() === pattern.toLowerCase() ||
               (pattern.trim().length > 1 && errorMessage.toLowerCase().includes(pattern.toLowerCase()));
      }
    });
  }

  /**
   * Create a default retry policy
   */
  public static createDefaultPolicy(): RetryPolicy {
    return {
      maxRetries: 3,
      initialBackoffMs: 1000,
      maxBackoffMs: 30000,
      backoffMultiplier: 2,
      enableJitter: true,
      retryableErrors: [
        'ECONNRESET',
        'ENOTFOUND',
        'ECONNREFUSED',
        'ETIMEDOUT',
        'NETWORK_ERROR',
        'TIMEOUT',
        'SERVICE_UNAVAILABLE',
        '429', // Rate limiting
        '500', // Internal server error
        '502', // Bad gateway
        '503', // Service unavailable
        '504'  // Gateway timeout
      ]
    };
  }
  /**
   * Create a retry policy for AWS operations
   */
  public static createAwsPolicy(): RetryPolicy {
    return {
      maxRetries: 5,
      initialBackoffMs: 500,
      maxBackoffMs: 20000,
      backoffMultiplier: 2,
      enableJitter: true,
      retryableErrors: [
        'ThrottlingException',
        'RequestTimeout',
        'ServiceUnavailable',
        'InternalError',
        'SlowDown',
        'RequestTimeTooSkewed',
        'ECONNRESET',
        'ENOTFOUND',
        'ETIMEDOUT',
        '500',
        '502',
        '503',
        '504'
      ]
    };
  }

  /**
   * Create a retry policy for Azure operations
   */
  public static createAzurePolicy(): RetryPolicy {
    return {
      maxRetries: 4,
      initialBackoffMs: 800,
      maxBackoffMs: 25000,
      backoffMultiplier: 2.5,
      enableJitter: true,
      retryableErrors: [
        'TooManyRequests',
        'InternalServerError',
        'BadGateway',
        'ServiceUnavailable',
        'GatewayTimeout',
        'ECONNRESET',
        'ENOTFOUND',
        'ETIMEDOUT',
        '429',
        '500',
        '502',
        '503',
        '504'
      ]
    };
  }

  /**
   * Utility method for delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Dead Letter Queue interface for handling exhausted retries
 */
export interface DeadLetterQueue {
  /**
   * Send an item to the dead letter queue
   */
  send(item: unknown, error: Error, context?: string): Promise<void>;
  
  /**
   * Get items from the dead letter queue for manual processing
   */
  receive(maxItems?: number): Promise<DeadLetterItem[]>;
  
  /**
   * Delete an item from the dead letter queue
   */
  delete(itemId: string): Promise<void>;
}

/**
 * Dead letter queue item
 */
export interface DeadLetterItem {
  id: string;
  item: unknown;
  error: ProcessingError;
  context?: string;
  timestamp: Date;
  retryCount: number;
}

/**
 * Simple in-memory dead letter queue implementation
 * In production, this should be replaced with a persistent queue (SQS, Service Bus, etc.)
 */
export class InMemoryDeadLetterQueue implements DeadLetterQueue {
  private items = new Map<string, DeadLetterItem>();
  private itemCounter = 0;

  public async send(item: unknown, error: Error, context?: string): Promise<void> {
    const id = `dlq-${++this.itemCounter}-${Date.now()}`;
    
    const dlqItem: DeadLetterItem = {
      id,
      item,
      error: {
        code: (error as any).code || error.name || 'UNKNOWN_ERROR',
        message: error.message,
        timestamp: new Date(),
        stackTrace: error.stack
      },
      context,
      timestamp: new Date(),
      retryCount: 0
    };
    
    this.items.set(id, dlqItem);
  }

  public async receive(maxItems = 10): Promise<DeadLetterItem[]> {
    const items = Array.from(this.items.values()).slice(0, maxItems);
    return items;
  }

  public async delete(itemId: string): Promise<void> {
    this.items.delete(itemId);
  }

  public getSize(): number {
    return this.items.size;
  }

  public clear(): void {
    this.items.clear();
  }
}
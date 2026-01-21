/**
 * Property-based tests for RetryHandler
 * **Feature: guardduty-sentinel-integration, Property 5: Retry Logic with Exponential Backoff**
 * **Validates: Requirements 3.2, 3.3**
 */

import fc from 'fast-check';
import { RetryHandler, InMemoryDeadLetterQueue } from '../../src/services/retry-handler';
import { RetryPolicy } from '../../src/types/configuration';

describe('RetryHandler Property Tests', () => {
  /**
   * Property 5: Retry Logic with Exponential Backoff
   * For any transmission failure, the ingestion worker should implement exponential backoff 
   * retry logic, and when retries are exhausted, should log failures and optionally send 
   * to dead letter queue.
   */
  describe('Property 5: Retry Logic with Exponential Backoff', () => {
    it('should respect retry limits for any policy configuration', async () => {
      await fc.assert(
        fc.asyncProperty(
          // Generate retry policy parameters
          fc.integer({ min: 1, max: 5 }), // maxRetries
          fc.integer({ min: 10, max: 500 }), // initialBackoffMs
          fc.float({ min: Math.fround(1.1), max: Math.fround(3.0) }), // backoffMultiplier
          fc.integer({ min: 100, max: 2000 }), // maxBackoffMs
          fc.boolean(), // enableJitter
          async (maxRetries, initialBackoffMs, backoffMultiplier, maxBackoffMs, enableJitter) => {
            const policy: RetryPolicy = {
              maxRetries,
              initialBackoffMs,
              maxBackoffMs,
              backoffMultiplier,
              enableJitter,
              retryableErrors: ['TEST_ERROR']
            };

            const retryHandler = new RetryHandler(policy);
            let attemptCount = 0;

            const failingOperation = async () => {
              attemptCount++;
              const error = new Error('Test error');
              (error as any).code = 'TEST_ERROR';
              throw error;
            };

            try {
              await retryHandler.executeWithRetry(failingOperation);
              // Should not reach here
              expect(false).toBe(true);
            } catch (error) {
              // Property: Should attempt exactly maxRetries + 1 times (initial + retries)
              expect(attemptCount).toBe(maxRetries + 1);
            }
          }
        ),
        { numRuns: 10, timeout: 10000 }
      );
    });

    it('should implement exponential backoff with proper delay calculation', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 10, max: 50 }), // initialBackoffMs - reduced for faster tests
          fc.float({ min: Math.fround(1.5), max: Math.fround(2.5) }), // backoffMultiplier - reduced range
          fc.integer({ min: 100, max: 300 }), // maxBackoffMs - reduced for faster tests
          async (initialBackoffMs, backoffMultiplier, maxBackoffMs) => {
            const policy: RetryPolicy = {
              maxRetries: 2, // Reduced retries for faster tests
              initialBackoffMs,
              maxBackoffMs,
              backoffMultiplier,
              enableJitter: false, // Disable jitter for predictable testing
              retryableErrors: ['TEST_ERROR']
            };

            const retryHandler = new RetryHandler(policy);
            const delays: number[] = [];
            let attemptCount = 0;

            retryHandler.on('retry-attempt', (_attempt, _error, delayMs) => {
              delays.push(delayMs);
            });

            const failingOperation = async () => {
              attemptCount++;
              const error = new Error('Test error');
              (error as any).code = 'TEST_ERROR';
              throw error;
            };

            try {
              await retryHandler.executeWithRetry(failingOperation);
            } catch (error) {
              // Property: Delays should follow exponential backoff pattern
              expect(delays).toHaveLength(2); // 2 retries
              
              // Check exponential progression (within max limit)
              for (let i = 0; i < delays.length; i++) {
                const expectedDelay = Math.min(
                  initialBackoffMs * Math.pow(backoffMultiplier, i),
                  maxBackoffMs
                );
                expect(delays[i]).toBeCloseTo(expectedDelay, 0);
              }
            }
          }
        ),
        { numRuns: 5, timeout: 5000 } // Reduced runs and timeout
      );
    });
    it('should handle dead letter queue integration correctly', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 3 }), // maxRetries
          fc.array(fc.record({
            id: fc.string({ minLength: 1, maxLength: 20 }),
            data: fc.string({ minLength: 1, maxLength: 50 })
          }), { minLength: 1, maxLength: 5 }), // test items
          async (maxRetries, testItems) => {
            const policy: RetryPolicy = {
              maxRetries,
              initialBackoffMs: 10,
              maxBackoffMs: 100,
              backoffMultiplier: 2,
              enableJitter: false,
              retryableErrors: ['TEST_ERROR']
            };

            const dlq = new InMemoryDeadLetterQueue();
            const retryHandler = new RetryHandler(policy, dlq);
            
            let dlqItemCount = 0;
            retryHandler.on('dead-letter-queued', () => {
              dlqItemCount++;
            });

            const failingOperation = async () => {
              const error = new Error('Persistent error');
              (error as any).code = 'TEST_ERROR';
              throw error;
            };

            // Process all test items
            for (const item of testItems) {
              const result = await retryHandler.executeWithRetryAndDLQ(
                failingOperation,
                item,
                'test-context'
              );
              
              // Property: Should return null when sent to DLQ
              expect(result).toBeNull();
            }

            // Property: All failed items should be in DLQ
            expect(dlqItemCount).toBe(testItems.length);
            expect(dlq.getSize()).toBe(testItems.length);
            
            const dlqItems = await dlq.receive();
            expect(dlqItems).toHaveLength(testItems.length);
          }
        ),
        { numRuns: 5, timeout: 8000 }
      );
    });

    it('should only retry retryable errors', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 1, maxLength: 5 }), // retryableErrors
          fc.string({ minLength: 1, maxLength: 20 }), // non-retryable error code
          async (retryableErrors, nonRetryableErrorCode) => {
            // Ensure non-retryable error is not in the retryable list
            if (retryableErrors.includes(nonRetryableErrorCode)) {
              return; // Skip this test case
            }

            const policy: RetryPolicy = {
              maxRetries: 3,
              initialBackoffMs: 10,
              maxBackoffMs: 100,
              backoffMultiplier: 2,
              enableJitter: false,
              retryableErrors
            };

            const retryHandler = new RetryHandler(policy);
            let attemptCount = 0;

            // Test with retryable error
            const retryableOperation = async () => {
              attemptCount++;
              const error = new Error('Retryable error');
              (error as any).code = retryableErrors[0];
              throw error;
            };

            try {
              await retryHandler.executeWithRetry(retryableOperation);
            } catch (error) {
              // Property: Should retry retryable errors
              expect(attemptCount).toBe(policy.maxRetries + 1);
            }

            // Reset counter
            attemptCount = 0;

            // Test with non-retryable error
            const nonRetryableOperation = async () => {
              attemptCount++;
              const error = new Error('Non-retryable error');
              (error as any).code = nonRetryableErrorCode;
              throw error;
            };

            try {
              await retryHandler.executeWithRetry(nonRetryableOperation);
            } catch (error) {
              // Property: Should not retry non-retryable errors
              expect(attemptCount).toBe(1);
            }
          }
        ),
        { numRuns: 5, timeout: 5000 }
      );
    });
  });
});
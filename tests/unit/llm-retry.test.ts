import { describe, expect, it } from 'vitest';
import { LLMError, cancelledError, retryWithBackoff } from '../../src/llm/index.js';

const transient = (): Error => Object.assign(new Error('429'), { status: 429 });

describe('retryWithBackoff', () => {
  it('returns the result when the call succeeds', async () => {
    const result = await retryWithBackoff(async () => 42, { maxRetries: 3 });
    expect(result).toBe(42);
  });

  it('retries transient failures and eventually succeeds', async () => {
    let attempts = 0;
    const result = await retryWithBackoff(
      async () => {
        attempts += 1;
        if (attempts < 3) {
          throw transient();
        }
        return 'ok';
      },
      { maxRetries: 3, initialDelayMs: 2 },
    );
    expect(result).toBe('ok');
    expect(attempts).toBe(3);
  });

  it('gives up after maxRetries on persistent transient errors', async () => {
    let attempts = 0;
    await expect(
      retryWithBackoff(
        async () => {
          attempts += 1;
          throw transient();
        },
        { maxRetries: 3, initialDelayMs: 2 },
      ),
    ).rejects.toMatchObject({ status: 429 });
    expect(attempts).toBe(3);
  });

  it('does not retry non-retryable errors', async () => {
    let attempts = 0;
    await expect(
      retryWithBackoff(
        async () => {
          attempts += 1;
          throw new Error('boom');
        },
        { maxRetries: 3, initialDelayMs: 2 },
      ),
    ).rejects.toThrow('boom');
    expect(attempts).toBe(1);
  });

  it('honours a custom isRetryable predicate', async () => {
    let attempts = 0;
    const result = await retryWithBackoff(
      async () => {
        attempts += 1;
        if (attempts < 2) {
          throw new Error('retry-me');
        }
        return 'done';
      },
      { maxRetries: 3, initialDelayMs: 2, isRetryable: (error) => error instanceof Error },
    );
    expect(result).toBe('done');
    expect(attempts).toBe(2);
  });

  it('respects an already-aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      retryWithBackoff(async () => 'x', { signal: controller.signal }),
    ).rejects.toSatisfy((error) => error instanceof LLMError && error.code === 'cancelled');
  });

  it('aborts the backoff sleep when the signal fires', async () => {
    const controller = new AbortController();
    let attempts = 0;
    const promise = retryWithBackoff(
      async () => {
        attempts += 1;
        throw transient();
      },
      { maxRetries: 5, initialDelayMs: 10_000, signal: controller.signal },
    );
    setTimeout(() => controller.abort(), 20);
    await expect(promise).rejects.toSatisfy(
      (error) => error instanceof LLMError && error.code === 'cancelled',
    );
    expect(attempts).toBe(1);
  });

  it('cancelledError helper builds a cancelled LLMError', () => {
    expect(cancelledError('nvidia').providerId).toBe('nvidia');
  });
});

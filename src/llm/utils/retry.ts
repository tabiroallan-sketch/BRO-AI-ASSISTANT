import { cancelledError, isTransientError } from './errors.js';

export type RetryOptions = {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  factor?: number;
  isRetryable?: (error: unknown) => boolean;
  onRetry?: (error: unknown, attempt: number) => void;
  signal?: AbortSignal;
};

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_INITIAL_DELAY_MS = 1000;
const DEFAULT_MAX_DELAY_MS = 8000;
const DEFAULT_FACTOR = 2;

export async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) {
    return sleep(ms);
  }
  if (signal.aborted) {
    throw cancelledError('unknown');
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  await new Promise<void>((resolve, reject) => {
    const onAbort = (): void => {
      if (timer) {
        clearTimeout(timer);
      }
      signal.removeEventListener('abort', onAbort);
      reject(cancelledError('unknown'));
    };
    timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const initialDelayMs = options.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const factor = options.factor ?? DEFAULT_FACTOR;
  const isRetryable = options.isRetryable ?? isTransientError;
  const onRetry = options.onRetry;

  let lastError: unknown;
  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    if (options.signal?.aborted) {
      throw cancelledError('unknown');
    }
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === maxRetries - 1 || !isRetryable(error)) {
        throw error;
      }
      onRetry?.(error, attempt + 1);
      const delay = Math.min(maxDelayMs, initialDelayMs * factor ** attempt);
      await sleepWithAbort(delay, options.signal);
    }
  }
  throw lastError;
}

import { describe, expect, it } from 'vitest';
import {
  LLMError,
  cancelledError,
  classifyHttpError,
  isAuthError,
  isCancelled,
  isRateLimited,
  isRetryableCode,
  isRetryableError,
} from '../../src/llm/index.js';

describe('LLMError taxonomy', () => {
  it('classifies auth failures (401/403)', () => {
    const error = classifyHttpError({ providerId: 'openai', status: 401 });
    expect(error.code).toBe('auth_failed');
    expect(isAuthError(error)).toBe(true);
    expect(error.retryable).toBe(false);
  });

  it('classifies rate limits (429) as retryable', () => {
    const error = classifyHttpError({ providerId: 'nvidia', status: 429 });
    expect(error.code).toBe('rate_limited');
    expect(isRateLimited(error)).toBe(true);
    expect(error.retryable).toBe(true);
  });

  it('classifies unavailable models (404)', () => {
    const error = classifyHttpError({ providerId: 'gemini', status: 404 });
    expect(error.code).toBe('model_unavailable');
    expect(error.retryable).toBe(false);
  });

  it('classifies server errors (5xx) as network', () => {
    const error = classifyHttpError({ providerId: 'ollama', status: 502 });
    expect(error.code).toBe('network');
    expect(error.retryable).toBe(true);
  });

  it('falls back to unknown for other statuses', () => {
    const error = classifyHttpError({ providerId: 'openrouter', status: 600 });
    expect(error.code).toBe('unknown');
    expect(error.retryable).toBe(false);
  });

  it('maps invalid requests (400)', () => {
    const error = classifyHttpError({ providerId: 'openai', status: 400 });
    expect(error.code).toBe('invalid_request');
  });

  it('provides user-friendly default messages', () => {
    const error = classifyHttpError({ providerId: 'nvidia', status: 429 });
    expect(error.message).toContain('rate-limiting');
  });

  it('cancelled errors are not retryable and detectable', () => {
    const error = cancelledError('nvidia');
    expect(error.code).toBe('cancelled');
    expect(isCancelled(error)).toBe(true);
    expect(error.retryable).toBe(false);
  });

  it('retryable codes helper', () => {
    expect(isRetryableCode('rate_limited')).toBe(true);
    expect(isRetryableCode('timeout')).toBe(true);
    expect(isRetryableCode('network')).toBe(true);
    expect(isRetryableCode('auth_failed')).toBe(false);
    expect(isRetryableCode('unknown')).toBe(false);
  });

  it('isRetryableError only for retryable LLMErrors', () => {
    expect(isRetryableError(classifyHttpError({ providerId: 'nvidia', status: 429 }))).toBe(true);
    expect(isRetryableError(new Error('plain'))).toBe(false);
  });

  it('carries provider id and cause', () => {
    const cause = new Error('boom');
    const error = new LLMError({
      code: 'unknown',
      providerId: 'ollama',
      message: 'boom',
      cause,
    });
    expect(error.providerId).toBe('ollama');
    expect(error.cause).toBe(cause);
  });
});

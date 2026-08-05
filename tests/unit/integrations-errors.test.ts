import { describe, expect, it } from 'vitest';
import {
  ProviderError,
  isProviderError,
  notConnectedError,
  providerErrorFromHttp,
  toUserMessage,
} from '../../src/integrations/errors.js';

describe('ProviderError', () => {
  it('carries a code, provider id, status, and retryable flag', () => {
    const error = new ProviderError('boom', {
      code: 'RATE_LIMITED',
      providerId: 'github',
      status: 429,
    });
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('RATE_LIMITED');
    expect(error.providerId).toBe('github');
    expect(error.status).toBe(429);
    expect(error.retryable).toBe(true);
  });

  it('defaults retryable to false and status to null', () => {
    const error = new ProviderError('nope', { code: 'MISSING_SCOPE', providerId: 'slack' });
    expect(error.retryable).toBe(false);
    expect(error.status).toBeNull();
  });

  it('is detected by isProviderError', () => {
    expect(isProviderError(new ProviderError('x', { code: 'NETWORK', providerId: 'a' }))).toBe(
      true,
    );
    expect(isProviderError(new Error('x'))).toBe(false);
    expect(isProviderError('x')).toBe(false);
  });

  it('builds the canonical not-connected message', () => {
    expect(notConnectedError('Google Calendar')).toContain('has not connected Google Calendar');
    expect(notConnectedError('Google Calendar')).toContain('Settings → Integrations');
  });
});

describe('providerErrorFromHttp', () => {
  it('maps 401 to invalid credentials', () => {
    const error = providerErrorFromHttp('github', 'GitHub', 401);
    expect(error.code).toBe('INVALID_CREDENTIALS');
    expect(error.retryable).toBe(false);
  });

  it('maps 403 to missing scope', () => {
    const error = providerErrorFromHttp('gmail', 'Gmail', 403);
    expect(error.code).toBe('MISSING_SCOPE');
  });

  it('maps 429 to rate limited and retryable', () => {
    const error = providerErrorFromHttp('slack', 'Slack', 429);
    expect(error.code).toBe('RATE_LIMITED');
    expect(error.retryable).toBe(true);
  });

  it('maps transport failures to network', () => {
    const error = providerErrorFromHttp('notion', 'Notion', null);
    expect(error.code).toBe('NETWORK');
    expect(error.retryable).toBe(true);
  });

  it('maps 5xx to response errors and marks them retryable', () => {
    const error = providerErrorFromHttp('drive', 'Drive', 503);
    expect(error.code).toBe('RESPONSE');
    expect(error.retryable).toBe(true);
  });

  it('preserves a supplied message', () => {
    const error = providerErrorFromHttp('a', 'A', 400, 'bad request');
    expect(error.message).toContain('bad request');
  });
});

describe('toUserMessage', () => {
  it('uses the provider message for missing tokens', () => {
    const error = new ProviderError('connect it', { code: 'TOKEN_MISSING', providerId: 'github' });
    expect(toUserMessage(error)).toBe('connect it');
  });

  it('explains rate limiting', () => {
    const error = new ProviderError('', { code: 'RATE_LIMITED', providerId: 'slack' });
    expect(toUserMessage(error)).toContain('rate limiting');
  });

  it('explains missing scope', () => {
    const error = new ProviderError('', { code: 'MISSING_SCOPE', providerId: 'gmail' });
    expect(toUserMessage(error)).toContain('missing a permission');
  });

  it('explains invalid credentials', () => {
    const error = new ProviderError('', { code: 'INVALID_CREDENTIALS', providerId: 'github' });
    expect(toUserMessage(error)).toContain('credentials are invalid');
  });

  it('explains network failures', () => {
    const error = new ProviderError('', { code: 'NETWORK', providerId: 'drive' });
    expect(toUserMessage(error)).toContain('Could not reach the provider');
  });

  it('falls back to the plain error message for unknown errors', () => {
    expect(toUserMessage(new Error('plain failure'))).toBe('plain failure');
    expect(toUserMessage('literal')).toBe('literal');
  });
});

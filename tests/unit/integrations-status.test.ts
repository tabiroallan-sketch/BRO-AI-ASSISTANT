import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

vi.mock('../../src/integrations/store.js', () => ({
  getIntegration: vi.fn(),
}));

vi.mock('../../src/integrations/trust-store.js', () => ({
  recordIntegrationStatus: vi.fn(async () => undefined),
  savePermissionSet: vi.fn(async () => undefined),
  startSync: vi.fn(async () => null),
  completeSync: vi.fn(async () => undefined),
  failSync: vi.fn(async () => undefined),
}));

import { getIntegration } from '../../src/integrations/store.js';
import { clearProviders, registerProvider } from '../../src/integrations/registry.js';
import {
  computeConnectionStatus,
  runHealthCheck,
  testConnection,
} from '../../src/integrations/status.js';
import type { OAuthProviderDef } from '../../src/integrations/types.js';

const getIntegrationMock = getIntegration as unknown as Mock;

const oauthProvider: OAuthProviderDef = {
  id: 'test-oauth',
  label: 'Test OAuth',
  description: 'A test OAuth provider',
  type: 'oauth',
  icon: 'external',
  oauthConfigured: true,
  scopes: ['read'],
  capabilities: ['test:read'],
  permissions: [],
  supportsRefresh: true,
  authorizationUrl: 'https://example.com/auth',
  tokenUrl: 'https://example.com/token',
  authorizationParams: () => new URLSearchParams(),
  tokenParams: () => new URLSearchParams(),
  refreshParams: () => new URLSearchParams(),
  accountName: async () => 'tester',
  async healthCheck() {
    return { ok: true, accountName: 'tester' };
  },
  tokenResponseAccessToken: (body) =>
    typeof body.access_token === 'string' ? body.access_token : null,
  tokenResponseRefreshToken: () => null,
  tokenResponseExpiresIn: () => 3600,
  tokenResponseScope: () => null,
};

const connectedRecord = {
  id: '1',
  userId: 'u1',
  provider: 'test-oauth',
  accountName: 'tester',
  externalId: null,
  accessToken: 'token',
  refreshToken: 'refresh',
  tokenExpiresAt: new Date(Date.now() + 3600_000),
  scopes: 'read',
  metadata: {},
  createdAt: new Date(),
};

describe('computeConnectionStatus', () => {
  it('reports not_connected when there is no integration', () => {
    expect(computeConnectionStatus(null, oauthProvider)).toBe('not_connected');
  });

  it('reports connected while the token is valid', () => {
    expect(computeConnectionStatus(connectedRecord, oauthProvider)).toBe('connected');
  });

  it('reports needs_refresh within the refresh window when a refresh token exists', () => {
    const expiring = {
      ...connectedRecord,
      tokenExpiresAt: new Date(Date.now() + 30_000),
    };
    expect(computeConnectionStatus(expiring, oauthProvider)).toBe('needs_refresh');
  });

  it('reports needs_refresh for an expired token with a refresh token', () => {
    const expired = { ...connectedRecord, tokenExpiresAt: new Date(Date.now() - 1000) };
    expect(computeConnectionStatus(expired, oauthProvider)).toBe('needs_refresh');
  });

  it('reports expired when no refresh token is available', () => {
    const expired = {
      ...connectedRecord,
      refreshToken: null,
      tokenExpiresAt: new Date(Date.now() - 1000),
    };
    expect(computeConnectionStatus(expired, oauthProvider)).toBe('expired');
  });

  it('reports revoked when the account was revoked', () => {
    const revoked = {
      ...connectedRecord,
      revokedAt: new Date(),
      revokedReason: 'refresh_token_reuse',
    };
    expect(computeConnectionStatus(revoked, oauthProvider)).toBe('revoked');
  });

  it('reports revoked even when the token looks valid', () => {
    const revoked = {
      ...connectedRecord,
      tokenExpiresAt: new Date(Date.now() + 3600_000),
      revokedAt: new Date(),
    };
    expect(computeConnectionStatus(revoked, oauthProvider)).toBe('revoked');
  });

  it('treats non-oauth providers without expiry as connected', () => {
    const webhookRecord = { ...connectedRecord, tokenExpiresAt: null };
    const webhookProvider = { ...oauthProvider, type: 'webhook' as const };
    expect(computeConnectionStatus(webhookRecord, webhookProvider)).toBe('connected');
  });
});

describe('runHealthCheck', () => {
  beforeEach(() => {
    clearProviders();
    registerProvider(oauthProvider);
    getIntegrationMock.mockReset();
  });

  it('fails for an unknown provider', async () => {
    const result = await runHealthCheck('u1', 'missing');
    expect(result.ok).toBe(false);
    expect(result.status).toBe('error');
    expect(result.message).toContain('Unknown provider');
  });

  it('fails with not_connected when the user has no connection', async () => {
    getIntegrationMock.mockResolvedValue(null);
    const result = await runHealthCheck('u1', 'test-oauth');
    expect(result.ok).toBe(false);
    expect(result.status).toBe('not_connected');
    expect(result.latencyMs).toBeNull();
  });

  it('reports a healthy connection with latency', async () => {
    getIntegrationMock.mockResolvedValue(connectedRecord);
    const result = await runHealthCheck('u1', 'test-oauth');
    expect(result.ok).toBe(true);
    expect(result.status).toBe('connected');
    expect(result.accountName).toBe('tester');
    expect(typeof result.latencyMs).toBe('number');
  });

  it('reports an error when the provider probe fails', async () => {
    const failingProvider: OAuthProviderDef = {
      ...oauthProvider,
      async healthCheck() {
        return { ok: false, message: 'Down' };
      },
    };
    clearProviders();
    registerProvider(failingProvider);
    getIntegrationMock.mockResolvedValue(connectedRecord);
    const result = await runHealthCheck('u1', 'test-oauth');
    expect(result.ok).toBe(false);
    expect(result.status).toBe('error');
    expect(result.message).toBe('Down');
  });

  it('catches thrown probe errors', async () => {
    const throwingProvider: OAuthProviderDef = {
      ...oauthProvider,
      async healthCheck() {
        throw new Error('boom');
      },
    };
    clearProviders();
    registerProvider(throwingProvider);
    getIntegrationMock.mockResolvedValue(connectedRecord);
    const result = await runHealthCheck('u1', 'test-oauth');
    expect(result.ok).toBe(false);
    expect(result.status).toBe('error');
    expect(result.message).toBe('boom');
  });
});

describe('testConnection', () => {
  beforeEach(() => {
    clearProviders();
    registerProvider(oauthProvider);
    getIntegrationMock.mockReset();
  });

  it('returns the health result as a connection test result', async () => {
    getIntegrationMock.mockResolvedValue(connectedRecord);
    const result = await testConnection('u1', 'test-oauth');
    expect(result.ok).toBe(true);
    expect(result.accountName).toBe('tester');
    expect(result.latencyMs).not.toBeNull();
    expect(result.message).not.toBeNull();
  });
});

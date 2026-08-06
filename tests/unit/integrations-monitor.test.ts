import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => {
  const integrations: Array<Record<string, unknown>> = [];
  const refreshCalls: Array<{ provider: string; token: string }> = [];
  const rotated: Array<{ id: string }> = [];
  const revoked: Array<{ id: string; reason: string }> = [];

  let refreshOutcome: () => {
    accessToken: string;
    refreshToken: string | null;
    expiresIn: number;
    scope?: string;
  } = () => ({ accessToken: 'new_access', refreshToken: 'new_refresh', expiresIn: 3600 });

  return {
    integrations,
    refreshCalls,
    rotated,
    revoked,
    setRefreshOutcome(fn: typeof refreshOutcome): void {
      refreshOutcome = fn;
    },
    getRefreshOutcome(): typeof refreshOutcome {
      return refreshOutcome;
    },
  };
});

vi.mock('../../src/config/index.js', () => ({ config: { autoReconnectEnabled: true } }));

vi.mock('../../src/integrations/events.js', () => ({
  emitIntegrationEvent: vi.fn(),
}));

vi.mock('../../src/integrations/trust-store.js', () => ({
  recordIntegrationStatus: vi.fn(async () => undefined),
}));

vi.mock('../../src/integrations/oauth-engine.js', () => ({
  hashToken: (token: string): string => `hash:${token}`,
  secureEqual: (a: string, b: string): boolean => a === b,
  refreshAccessToken: vi.fn(async (provider: string, token: string) => {
    state.refreshCalls.push({ provider, token });
    return state.getRefreshOutcome()();
  }),
  withRefreshFlight: async <T>(_key: string, task: () => Promise<T>): Promise<T> => task(),
}));

vi.mock('../../src/integrations/status.js', () => ({
  runHealthCheck: vi.fn(),
}));

vi.mock('../../src/integrations/store.js', () => ({
  listConnectedIntegrations: vi.fn(async () => [...state.integrations]),
  revokeIntegration: vi.fn(async (id: string, reason: string) => {
    state.revoked.push({ id, reason });
  }),
  rotateIntegrationTokens: vi.fn(async (id: string) => {
    state.rotated.push({ id });
  }),
}));

import { config } from '../../src/config/index.js';
import * as monitor from '../../src/integrations/monitor.js';
import { runHealthCheck } from '../../src/integrations/status.js';
import {
  listConnectedIntegrations,
  revokeIntegration,
  rotateIntegrationTokens,
} from '../../src/integrations/store.js';
import { refreshAccessToken } from '../../src/integrations/oauth-engine.js';
import { recordIntegrationStatus } from '../../src/integrations/trust-store.js';
import { emitIntegrationEvent } from '../../src/integrations/events.js';
import type { HealthResult } from '../../src/integrations/types.js';

function row(id: string, metadata: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    userId: `user-${id}`,
    provider: 'github',
    accountKey: 'default',
    accountName: 'octocat',
    externalId: null,
    accessToken: 'access',
    refreshToken: 'refresh',
    refreshTokenHash: 'hash:refresh',
    tokenExpiresAt: new Date(Date.now() - 1000),
    scopes: null,
    metadata,
    isPrimary: true,
    lastRefreshedAt: null,
    refreshCount: 0,
    revokedAt: null,
    revokedReason: null,
    createdAt: new Date(),
  };
}

function healthResult(overrides: Partial<HealthResult>): HealthResult {
  return {
    ok: false,
    status: 'error',
    issue: 'error',
    code: null,
    latencyMs: 10,
    accountName: null,
    message: 'probe failed',
    checkedAt: new Date().toISOString(),
    ...overrides,
  };
}

const runHealthCheckMock = vi.mocked(runHealthCheck);

describe('integration health monitor', () => {
  beforeEach(() => {
    state.integrations.length = 0;
    state.refreshCalls.length = 0;
    state.rotated.length = 0;
    state.revoked.length = 0;
    state.setRefreshOutcome(() => ({
      accessToken: 'new_access',
      refreshToken: 'new_refresh',
      expiresIn: 3600,
    }));
    vi.clearAllMocks();
  });

  it('counts healthy and unhealthy integrations without touching unhealthy ones', async () => {
    state.integrations.push(row('a'), row('b'));
    runHealthCheckMock
      .mockResolvedValueOnce(healthResult({ ok: true, status: 'connected', issue: 'connected' }))
      .mockResolvedValueOnce(healthResult({ ok: false, issue: 'error' }));

    const summary = await monitor.runHealthSweep();
    expect(summary.ran).toBe(true);
    expect(summary.checked).toBe(2);
    expect(summary.healthy).toBe(1);
    expect(summary.unhealthy).toBe(1);
    expect(refreshAccessToken).not.toHaveBeenCalled();
  });

  it('auto-reconnects an expired token when auto-reconnect is on', async () => {
    state.integrations.push(row('a', { autoReconnect: true }));
    runHealthCheckMock
      .mockResolvedValueOnce(healthResult({ status: 'expired', issue: 'expired' }))
      .mockResolvedValueOnce(healthResult({ ok: true, status: 'connected', issue: 'connected' }));

    const summary = await monitor.runHealthSweep();
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(rotateIntegrationTokens).toHaveBeenCalledTimes(1);
    expect(summary.autoReconnected).toBe(1);
    expect(summary.unhealthy).toBe(1);
  });

  it('skips auto-reconnect for rate limited connections', async () => {
    state.integrations.push(row('a', { autoReconnect: true }));
    runHealthCheckMock.mockResolvedValue(healthResult({ issue: 'rate_limited' }));

    const summary = await monitor.runHealthSweep();
    expect(refreshAccessToken).not.toHaveBeenCalled();
    expect(summary.unhealthy).toBe(1);
  });

  it('disables a connection whose credentials failed to refresh', async () => {
    state.integrations.push(row('a', { autoReconnect: true }));
    state.setRefreshOutcome(() => {
      throw new Error('invalid_grant');
    });
    runHealthCheckMock.mockResolvedValue(healthResult({ issue: 'invalid_credentials' }));

    const summary = await monitor.runHealthSweep();
    expect(revokeIntegration).toHaveBeenCalledWith('a', 'invalid_credentials');
    expect(recordIntegrationStatus).toHaveBeenCalled();
    expect(summary.disabled).toBe(1);
  });

  it('honours the global auto-reconnect toggle', async () => {
    (config as { autoReconnectEnabled: boolean }).autoReconnectEnabled = false;
    state.integrations.push(row('a', { autoReconnect: true }));
    runHealthCheckMock.mockResolvedValue(healthResult({ issue: 'expired' }));

    await monitor.runHealthSweep();
    expect(refreshAccessToken).not.toHaveBeenCalled();
    (config as { autoReconnectEnabled: boolean }).autoReconnectEnabled = true;
  });

  it('emits a token_revoked event when a reused refresh token is detected', async () => {
    const bad = row('a', { autoReconnect: true });
    bad.refreshTokenHash = 'hash:different';
    state.integrations.push(bad);
    runHealthCheckMock.mockResolvedValue(healthResult({ issue: 'expired' }));

    const summary = await monitor.runHealthSweep();
    expect(revokeIntegration).toHaveBeenCalledWith('a', 'refresh_token_reuse');
    expect(emitIntegrationEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'token_revoked', reason: 'refresh_token_reuse' }),
    );
    expect(summary.autoReconnected).toBe(0);
  });

  it('is a no-op when there are no connected integrations', async () => {
    const summary = await monitor.runHealthSweep();
    expect(summary.checked).toBe(0);
    expect(summary.ran).toBe(true);
    expect(listConnectedIntegrations).toHaveBeenCalled();
  });
});

import { config } from '../config/index.js';
import { recordAudit } from '../lib/audit.js';
import { emitIntegrationEvent } from './events.js';
import { hashToken, refreshAccessToken, secureEqual, withRefreshFlight } from './oauth-engine.js';
import { runHealthCheck } from './status.js';
import {
  listConnectedIntegrations,
  revokeIntegration,
  rotateIntegrationTokens,
  type IntegrationRecord,
} from './store.js';
import { recordIntegrationStatus } from './trust-store.js';
import type { HealthResult } from './types.js';

export type HealthSweepSummary = {
  ran: boolean;
  checked: number;
  healthy: number;
  unhealthy: number;
  autoReconnected: number;
  disabled: number;
  startedAt: string | null;
  finishedAt: string | null;
};

type MonitorHandle = {
  stop: () => void;
  running: boolean;
};

let handle: MonitorHandle | null = null;
let sweepInFlight = false;
let lastSummary: HealthSweepSummary | null = null;

function isAutoReconnectEnabled(metadata: IntegrationRecord['metadata']): boolean {
  const value = (metadata as Record<string, unknown> | null | undefined)?.autoReconnect;
  return value === true;
}

function needsRefreshableToken(integration: IntegrationRecord): boolean {
  return Boolean(integration.refreshToken);
}

/**
 * Attempts to refresh an expired / invalid-credential connection using its
 * refresh token (the same code path the API `POST /integrations/:provider/refresh`
 * route uses). Returns true when a new access token was stored.
 */
export async function autoReconnect(integration: IntegrationRecord): Promise<boolean> {
  if (!needsRefreshableToken(integration) || !integration.refreshToken) {
    return false;
  }
  return withRefreshFlight(integration.id, async () => {
    if (
      integration.refreshTokenHash &&
      !secureEqual(hashToken(integration.refreshToken as string), integration.refreshTokenHash)
    ) {
      await revokeIntegration(integration.id, 'refresh_token_reuse');
      recordAudit({
        actorId: integration.userId,
        action: 'integration.revoke',
        target: integration.id,
        detail: 'refresh_token_reuse',
      });
      emitIntegrationEvent({
        type: 'token_revoked',
        provider: integration.provider,
        userId: integration.userId,
        reason: 'refresh_token_reuse',
      });
      return false;
    }
    try {
      const refreshed = await refreshAccessToken(
        integration.provider,
        integration.refreshToken as string,
      );
      await rotateIntegrationTokens(integration.id, {
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken ?? (integration.refreshToken as string),
        expiresIn: refreshed.expiresIn,
        scope: refreshed.scope ?? undefined,
        refreshCount: (integration.refreshCount ?? 0) + 1,
      });
      emitIntegrationEvent({
        type: 'token_refreshed',
        provider: integration.provider,
        userId: integration.userId,
      });
      return true;
    } catch {
      return false;
    }
  });
}

type UnhealthyOutcome = 'none' | 'rate_limited' | 'reconnected' | 'disabled';

async function handleUnhealthy(
  integration: IntegrationRecord,
  result: HealthResult,
): Promise<UnhealthyOutcome> {
  const reconnectAllowed =
    isAutoReconnectEnabled(integration.metadata) && config.autoReconnectEnabled;
  const issue = result.issue ?? 'error';

  if (issue === 'rate_limited') {
    // No point hammering the endpoint while it is throttling us. Record the
    // status (already done by runHealthCheck) and back off until the sweep.
    return 'rate_limited';
  }

  if (!reconnectAllowed || !needsRefreshableToken(integration)) {
    return 'none';
  }

  if (issue === 'expired' || issue === 'invalid_credentials' || issue === 'error') {
    const refreshed = await autoReconnect(integration);
    if (refreshed) {
      await runHealthCheck(integration.userId, integration.provider);
      return 'reconnected';
    }
    if (issue === 'invalid_credentials') {
      // The refresh token is dead (revoked on the provider side). Leave the
      // connection disabled locally so tools stop trying it; the user can
      // reconnect via the OAuth flow.
      await revokeIntegration(integration.id, 'invalid_credentials');
      recordAudit({
        actorId: integration.userId,
        action: 'integration.revoke',
        target: integration.id,
        detail: 'invalid_credentials',
      });
      emitIntegrationEvent({
        type: 'token_revoked',
        provider: integration.provider,
        userId: integration.userId,
        reason: 'invalid_credentials',
      });
      await recordIntegrationStatus(integration.id, {
        status: 'revoked',
        issue: 'invalid_credentials',
        ok: false,
        latencyMs: result.latencyMs,
        message: 'Connection disabled: invalid credentials after auto-reconnect failed',
        code: 'INVALID_CREDENTIALS',
      });
      return 'disabled';
    }
  }
  return 'none';
}

/**
 * Runs one health probe for every connected integration. Healthy and unhealthy
 * counts are returned so callers can log / surface a summary. Overlapping calls
 * (the interval firing while a long sweep is still running) are no-ops.
 */
export async function runHealthSweep(): Promise<HealthSweepSummary> {
  if (sweepInFlight) {
    return (
      lastSummary ?? {
        ran: false,
        checked: 0,
        healthy: 0,
        unhealthy: 0,
        autoReconnected: 0,
        disabled: 0,
        startedAt: null,
        finishedAt: null,
      }
    );
  }
  sweepInFlight = true;
  const startedAt = new Date().toISOString();
  const summary: HealthSweepSummary = {
    ran: true,
    checked: 0,
    healthy: 0,
    unhealthy: 0,
    autoReconnected: 0,
    disabled: 0,
    startedAt,
    finishedAt: null,
  };
  try {
    const integrations = await listConnectedIntegrations();
    for (const integration of integrations) {
      summary.checked += 1;
      const result = await runHealthCheck(integration.userId, integration.provider);
      if (result.ok) {
        summary.healthy += 1;
        continue;
      }
      summary.unhealthy += 1;
      const outcome = await handleUnhealthy(integration, result);
      if (outcome === 'reconnected') {
        summary.autoReconnected += 1;
      } else if (outcome === 'disabled') {
        summary.disabled += 1;
      }
    }
    summary.finishedAt = new Date().toISOString();
    lastSummary = summary;
    return summary;
  } finally {
    sweepInFlight = false;
  }
}

/**
 * Starts the periodic health sweep. Idempotent: calling it twice returns the
 * existing handle without spawning a second timer.
 */
export function startHealthMonitor(intervalMs: number): MonitorHandle {
  if (handle) {
    return handle;
  }
  const run = (): void => {
    runHealthSweep().catch(() => {
      // A failed sweep must not kill the timer; the next interval retries.
    });
  };
  void run();
  const timer = setInterval(run, intervalMs);
  if (typeof timer.unref === 'function') {
    timer.unref();
  }
  handle = {
    running: true,
    stop: (): void => {
      clearInterval(timer);
      handle = null;
    },
  };
  return handle;
}

export function stopHealthMonitor(): void {
  handle?.stop();
  handle = null;
}

export function getLastHealthSweep(): HealthSweepSummary | null {
  return lastSummary;
}

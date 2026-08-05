import { fetchProviderAccountName } from './oauth-engine.js';
import { getProvider } from './registry.js';
import { getIntegration } from './store.js';
import type { ConnectionStatus, ConnectionTestResult, HealthResult, ProviderDef } from './types.js';
import { emitIntegrationEvent } from './events.js';
import { completeSync, failSync, recordIntegrationStatus, startSync } from './trust-store.js';

export type IntegrationStatusInput = {
  tokenExpiresAt: Date | null;
  refreshToken: string | null;
  revokedAt?: Date | null;
};

/**
 * Derives a connection status from the stored token state. OAuth tokens are
 * treated as needing a refresh when they expire within the same 60s window the
 * credential store uses, so the UI and the refresh path agree.
 */
export function computeConnectionStatus(
  integration: IntegrationStatusInput | null,
  provider: ProviderDef,
): ConnectionStatus {
  if (!integration) {
    return 'not_connected';
  }
  if (integration.revokedAt) {
    return 'revoked';
  }
  if (provider.type === 'oauth' && integration.tokenExpiresAt) {
    const remainingMs = integration.tokenExpiresAt.getTime() - Date.now();
    if (remainingMs <= 60_000) {
      return integration.refreshToken ? 'needs_refresh' : 'expired';
    }
  }
  return 'connected';
}

function metadataOf(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

export async function runHealthCheck(userId: string, providerId: string): Promise<HealthResult> {
  const checkedAt = new Date().toISOString();
  const provider = getProvider(providerId);
  if (!provider) {
    return {
      ok: false,
      status: 'error',
      latencyMs: null,
      accountName: null,
      message: `Unknown provider "${providerId}"`,
      checkedAt,
    };
  }

  const integration = await getIntegration(userId, providerId);
  if (!integration) {
    emitIntegrationEvent({
      type: 'health_changed',
      provider: providerId,
      userId,
      status: 'not_connected',
    });
    return {
      ok: false,
      status: 'not_connected',
      latencyMs: null,
      accountName: null,
      message: `The user has not connected ${provider.label}. Ask them to connect it from Settings → Integrations, then try again.`,
      checkedAt,
    };
  }

  const token = integration.accessToken;
  const metadata = metadataOf(integration.metadata);
  const startedAt = Date.now();

  try {
    if (provider.healthCheck) {
      const probe = await provider.healthCheck(token, metadata);
      const latencyMs = Date.now() - startedAt;
      const status: ConnectionStatus = probe.ok ? 'connected' : 'error';
      emitIntegrationEvent({ type: 'health_changed', provider: providerId, userId, status });
      await recordIntegrationStatus(integration.id, {
        status,
        ok: probe.ok,
        latencyMs,
        message: probe.message ?? (probe.ok ? 'Connected' : 'Health check failed'),
      });
      return {
        ok: probe.ok,
        status,
        latencyMs,
        accountName: probe.accountName ?? null,
        message: probe.message ?? (probe.ok ? 'Connected' : 'Health check failed'),
        checkedAt,
      };
    }

    if (provider.type === 'oauth') {
      const accountName = await fetchProviderAccountName(providerId, token);
      const latencyMs = Date.now() - startedAt;
      const ok = accountName !== null;
      emitIntegrationEvent({
        type: 'health_changed',
        provider: providerId,
        userId,
        status: ok ? 'connected' : 'error',
      });
      await recordIntegrationStatus(integration.id, {
        status: ok ? 'connected' : 'error',
        ok,
        latencyMs,
        message: ok ? 'Connected' : 'Failed to reach the provider',
      });
      return {
        ok,
        status: ok ? 'connected' : 'error',
        latencyMs,
        accountName,
        message: ok ? 'Connected' : 'Failed to reach the provider',
        checkedAt,
      };
    }

    await recordIntegrationStatus(integration.id, {
      status: 'connected',
      ok: true,
      latencyMs: null,
      message: 'Connected',
    });
    return {
      ok: true,
      status: 'connected',
      latencyMs: null,
      accountName: integration.accountName,
      message: 'Connected',
      checkedAt,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Health check failed';
    await recordIntegrationStatus(integration.id, {
      status: 'error',
      ok: false,
      latencyMs: Date.now() - startedAt,
      message,
    });
    return {
      ok: false,
      status: 'error',
      latencyMs: Date.now() - startedAt,
      accountName: null,
      message,
      checkedAt,
    };
  }
}

export async function testConnection(
  userId: string,
  providerId: string,
): Promise<ConnectionTestResult> {
  const result = await runHealthCheck(userId, providerId);
  const integration = await getIntegration(userId, providerId);
  if (integration) {
    const syncId = await startSync(integration.id);
    if (syncId) {
      if (result.ok) {
        await completeSync(syncId, {
          detail: { provider: providerId, latencyMs: result.latencyMs },
        });
      } else {
        await failSync(syncId, result.message ?? 'Health check failed');
      }
    }
  }
  return {
    ok: result.ok,
    accountName: result.accountName,
    message: result.message,
    latencyMs: result.latencyMs,
  };
}

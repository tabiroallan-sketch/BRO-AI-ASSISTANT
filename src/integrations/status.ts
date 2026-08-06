import { fetchProviderAccountName } from './oauth-engine.js';
import { getProvider } from './registry.js';
import { getIntegration } from './store.js';
import type {
  ConnectionStatus,
  ConnectionTestResult,
  HealthIssue,
  HealthProbe,
  HealthResult,
  ProviderDef,
} from './types.js';
import { isProviderError } from './errors.js';
import { emitIntegrationEvent } from './events.js';
import { completeSync, failSync, recordIntegrationStatus, startSync } from './trust-store.js';

/**
 * Maps a ProviderError code (or probe-provided code) onto the human-facing
 * health classification shown in Connection Health. Unknown codes collapse to
 * a generic error.
 */
export function classifyHealthIssue(code: string | null | undefined): HealthIssue {
  switch (code) {
    case 'TOKEN_EXPIRED':
      return 'expired';
    case 'RATE_LIMITED':
      return 'rate_limited';
    case 'INVALID_CREDENTIALS':
      return 'invalid_credentials';
    case 'MISSING_SCOPE':
      return 'missing_scope';
    case 'PERMISSION_DENIED':
    case 'NOT_CONFIGURED':
      return 'error';
    case 'NETWORK':
      return 'network';
    case 'connected':
    case 'disconnected':
    case 'revoked':
      return code;
    default:
      return 'error';
  }
}

/**
 * Classifies a failed probe or thrown error. Prefers an explicit code on the
 * probe; falls back to the HTTP status of a ProviderError, then to a generic
 * error for anything else.
 */
export function classifyFailure(
  probe: HealthProbe | null,
  error: unknown,
): { issue: HealthIssue; code: string | null } {
  const probeCode = typeof probe?.code === 'string' && probe.code !== '' ? probe.code : null;
  if (probeCode) {
    const issue = classifyHealthIssue(probeCode);
    return { issue, code: probeCode };
  }
  if (isProviderError(error)) {
    return { issue: classifyHealthIssue(error.code), code: error.code };
  }
  return { issue: 'error', code: null };
}

export function issueLabel(issue: HealthIssue): string {
  switch (issue) {
    case 'connected':
      return 'Connected';
    case 'disconnected':
      return 'Disconnected';
    case 'expired':
      return 'Expired token';
    case 'rate_limited':
      return 'Rate limited';
    case 'invalid_credentials':
      return 'Invalid credentials';
    case 'missing_scope':
      return 'Missing scope';
    case 'revoked':
      return 'Revoked';
    case 'network':
      return 'Network error';
    default:
      return 'Error';
  }
}

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
      issue: 'error',
      code: null,
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
      issue: 'disconnected',
      code: null,
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
      let probe: HealthProbe;
      try {
        probe = await provider.healthCheck(token, metadata);
      } catch (error) {
        const { issue, code } = classifyFailure(null, error);
        const message = error instanceof Error ? error.message : 'Health check failed';
        await recordIntegrationStatus(integration.id, {
          status: 'error',
          issue,
          ok: false,
          latencyMs: Date.now() - startedAt,
          message,
          code,
        });
        return {
          ok: false,
          status: 'error',
          issue,
          code,
          latencyMs: Date.now() - startedAt,
          accountName: null,
          message,
          checkedAt,
        };
      }
      const latencyMs = Date.now() - startedAt;
      const { issue, code } = classifyFailure(probe, null);
      const status: ConnectionStatus = probe.ok ? 'connected' : 'error';
      emitIntegrationEvent({ type: 'health_changed', provider: providerId, userId, status });
      await recordIntegrationStatus(integration.id, {
        status,
        issue,
        ok: probe.ok,
        latencyMs,
        message: probe.message ?? (probe.ok ? 'Connected' : 'Health check failed'),
        code,
        apiStatus: probe.apiStatus ?? null,
        quota: probe.quota ?? null,
      });
      return {
        ok: probe.ok,
        status,
        issue,
        code,
        latencyMs,
        accountName: probe.accountName ?? null,
        message: probe.message ?? (probe.ok ? 'Connected' : 'Health check failed'),
        quota: probe.quota ?? null,
        apiStatus: probe.apiStatus ?? null,
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
        issue: ok ? 'connected' : 'error',
        ok,
        latencyMs,
        message: ok ? 'Connected' : 'Failed to reach the provider',
      });
      return {
        ok,
        status: ok ? 'connected' : 'error',
        issue: ok ? 'connected' : 'error',
        code: null,
        latencyMs,
        accountName,
        message: ok ? 'Connected' : 'Failed to reach the provider',
        checkedAt,
      };
    }

    await recordIntegrationStatus(integration.id, {
      status: 'connected',
      issue: 'connected',
      ok: true,
      latencyMs: null,
      message: 'Connected',
    });
    return {
      ok: true,
      status: 'connected',
      issue: 'connected',
      code: null,
      latencyMs: null,
      accountName: integration.accountName,
      message: 'Connected',
      checkedAt,
    };
  } catch (error) {
    const { issue, code } = classifyFailure(null, error);
    const message = error instanceof Error ? error.message : 'Health check failed';
    await recordIntegrationStatus(integration.id, {
      status: 'error',
      issue,
      ok: false,
      latencyMs: Date.now() - startedAt,
      message,
      code,
    });
    return {
      ok: false,
      status: 'error',
      issue,
      code,
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

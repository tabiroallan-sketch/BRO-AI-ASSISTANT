import { listLeadProviders } from './provider-registry.js';
import type { ProviderHealthResult, ProviderStatus } from './types.js';

const HEALTH_TIMEOUT_MS = 10000;

/**
 * Runs live health checks against every registered lead provider in parallel.
 * Unlike `getProviderStatuses()` (which reports static configuration), this
 * actually probes each provider's API and returns a real status.
 *
 * A single provider failure never rejects the whole call.
 */
export async function getLiveProviderStatuses(): Promise<ProviderHealthResult[]> {
  const providers = listLeadProviders();
  const checks = providers.map(async (provider): Promise<ProviderHealthResult> => {
    const configured = provider.isConfigured();
    const start = Date.now();

    if (!configured) {
      return {
        providerId: provider.id,
        label: provider.label,
        status: 'not_configured',
        message:
          provider.id === 'reddit' || provider.id === 'indeed'
            ? 'Works without configuration (rate-limited public access)'
            : 'API credentials not configured',
      };
    }

    if (!provider.healthCheck) {
      return {
        providerId: provider.id,
        label: provider.label,
        status: 'connected',
        message: 'Configured (no live check available)',
      };
    }

    try {
      const result = await Promise.race([
        provider.healthCheck(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Health check timed out')), HEALTH_TIMEOUT_MS),
        ),
      ]);

      const status: ProviderStatus = result.ok ? 'connected' : 'degraded';
      return {
        providerId: provider.id,
        label: provider.label,
        status,
        message: result.message,
        latencyMs: result.latencyMs ?? Date.now() - start,
      };
    } catch {
      return {
        providerId: provider.id,
        label: provider.label,
        status: 'error',
        message: 'Health check failed',
        latencyMs: Date.now() - start,
      };
    }
  });

  return Promise.all(checks);
}

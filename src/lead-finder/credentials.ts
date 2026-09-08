export type LeadCredentialMapping = {
  /** Admin credential-store provider id (see credential-store.ts). */
  storeId: string;
  /** Which stored field holds the API key / access token. */
  field: 'apiKey' | 'clientId' | 'clientSecret' | 'accessToken';
};

const LEAD_PROVIDER_CREDENTIALS: Record<string, LeadCredentialMapping> = {
  google_maps: { storeId: 'google_maps', field: 'apiKey' },
  reddit: { storeId: 'reddit', field: 'clientId' },
  web: { storeId: 'serpapi', field: 'apiKey' },
  linkedin: { storeId: 'serpapi', field: 'apiKey' },
};

let runtimeCache: Record<string, Record<string, string>> | null = null;

/**
 * Reloads runtime (admin-stored) credentials for the lead-finder providers.
 * Call after an admin saves credentials so providers pick up new values
 * without changing the env-based `config` object.
 */
export async function reloadLeadCredentials(): Promise<void> {
  const { getAllCredentials } = await import('../integrations/credential-store.js');
  const all = await getAllCredentials();
  const resolved: Record<string, Record<string, string>> = {};
  for (const [providerId, mapping] of Object.entries(LEAD_PROVIDER_CREDENTIALS)) {
    const stored = all[mapping.storeId];
    const fields: Record<string, string> = {};
    if (stored?.apiKey) fields.apiKey = stored.apiKey;
    if (stored?.clientId) fields.clientId = stored.clientId;
    if (stored?.clientSecret) fields.clientSecret = stored.clientSecret;
    if (stored?.accessToken) fields.accessToken = stored.accessToken;
    if (stored?.extra) {
      for (const [k, v] of Object.entries(stored.extra)) {
        if (v) fields[k] = v;
      }
    }
    resolved[providerId] = fields;
  }
  runtimeCache = resolved;
}

export async function getLeadCredential(
  providerId: string,
  field: string,
): Promise<string | undefined> {
  if (!runtimeCache) {
    await reloadLeadCredentials();
  }
  return runtimeCache?.[providerId]?.[field];
}

/**
 * Synchronous credential lookup. Only reflects credentials already loaded into
 * the runtime cache (i.e. after `reloadLeadCredentials()` has been called at
 * startup / on admin save). Used by synchronous `isConfigured()` checks.
 */
export function getLeadCredentialSync(providerId: string, field: string): string | undefined {
  return runtimeCache?.[providerId]?.[field];
}

/** Returns the effective API key, preferring runtime credentials then env config. */
export async function resolveLeadApiKey(providerId: string, envFallback: string): Promise<string> {
  const runtime = await getLeadCredential(providerId, 'apiKey');
  if (runtime) return runtime;
  return envFallback;
}

export function invalidateLeadCredentialCache(): void {
  runtimeCache = null;
}

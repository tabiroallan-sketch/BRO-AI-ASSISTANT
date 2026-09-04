import { listLeadProviders, getProviderStatuses } from './provider-registry.js';
import type { LeadSearchParams, LeadSource, ProviderSearchResult, RawLead } from './types.js';

const PROVIDER_TIMEOUT_MS = 15000;

/**
 * Runs all lead providers in parallel and collects results.
 * Provider failures are captured as errors — a single provider failure
 * never prevents the rest from succeeding.
 */
export async function searchProviders(params: LeadSearchParams): Promise<ProviderSearchResult[]> {
  const requestedSources = params.sources ?? [];
  const providers = listLeadProviders().filter((p) => {
    if (!requestedSources.length) return p.isConfigured();
    return p.sources.some((s) => requestedSources.includes(s));
  });

  const searches = providers.map(async (provider): Promise<ProviderSearchResult> => {
    const start = Date.now();
    try {
      const leads = await Promise.race([
        provider.search(params),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`${provider.label} timed out`)), PROVIDER_TIMEOUT_MS),
        ),
      ]);
      return {
        providerId: provider.id,
        leads,
        latencyMs: Date.now() - start,
      };
    } catch (error) {
      return {
        providerId: provider.id,
        leads: [],
        error: error instanceof Error ? error.message : String(error),
        latencyMs: Date.now() - start,
      };
    }
  });

  return Promise.all(searches);
}

/**
 * Combines results from multiple provider searches, adding the source
 * identifier to each lead for later deduplication.
 */
export function combineResults(providerResults: ProviderSearchResult[]): RawLead[] {
  const combined: RawLead[] = [];
  for (const result of providerResults) {
    for (const lead of result.leads) {
      combined.push({
        ...lead,
        source: lead.source,
      });
    }
  }
  return combined;
}

export { getProviderStatuses };
export type { LeadSearchParams, ProviderSearchResult, RawLead, LeadSource };

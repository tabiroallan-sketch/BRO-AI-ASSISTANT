import { cacheGet, cacheSet } from '../lib/cache.js';
import { listLeadProviders, getProviderStatuses } from './provider-registry.js';
import type { LeadSearchParams, LeadSource, ProviderSearchResult, RawLead } from './types.js';

const PROVIDER_TIMEOUT_MS = 15000;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function cacheKey(providerId: string, params: LeadSearchParams): string {
  const { query, industry, location, city, state, country, keywords, limit, sources } = params;
  return `lead:${providerId}:${JSON.stringify({
    query,
    industry,
    location,
    city,
    state,
    country,
    keywords,
    limit,
    sources,
  })}`;
}

/**
 * Runs all lead providers in parallel and collects results.
 * Provider failures are captured as errors — a single provider failure
 * never prevents the rest from succeeding. Successful (non-empty) results are
 * cached briefly so repeated searches don't re-pay for the same API calls.
 */
export async function searchProviders(params: LeadSearchParams): Promise<ProviderSearchResult[]> {
  const requestedSources = params.sources ?? [];
  const providers = listLeadProviders().filter((p) => {
    if (!requestedSources.length) return p.isConfigured();
    return p.sources.some((s) => requestedSources.includes(s));
  });

  const searches = providers.map(async (provider): Promise<ProviderSearchResult> => {
    const cacheKeyForProvider = cacheKey(provider.id, params);
    const cached = cacheGet<RawLead[]>(cacheKeyForProvider);
    if (cached) {
      return {
        providerId: provider.id,
        leads: cached,
        latencyMs: 0,
      };
    }

    const start = Date.now();
    try {
      const leads = await Promise.race([
        provider.search(params),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`${provider.label} timed out`)), PROVIDER_TIMEOUT_MS),
        ),
      ]);
      if (leads.length > 0) {
        cacheSet(cacheKeyForProvider, leads, CACHE_TTL_MS);
      }
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

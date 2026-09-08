import { fetchJson } from '../../lib/http.js';
import { config } from '../../config/index.js';
import { getLeadCredentialSync, resolveLeadApiKey } from '../credentials.js';
import type { LeadProvider, LeadSearchParams, LeadSource, RawLead } from '../types.js';

const SERP_API_URL = 'https://serpapi.com/search.json';
const REQUEST_TIMEOUT_MS = 12000;

type SerpLinkedInResult = {
  title?: string;
  snippet?: string;
  link?: string;
  displayed_link?: string;
};

type SerpApiLinkedInResponse = {
  organic_results?: SerpLinkedInResult[];
  error?: string;
};

/**
 * LinkedIn provider via SerpAPI (site:linkedin.com).
 *
 * This does NOT use any unofficial LinkedIn scraping or API. It searches
 * public LinkedIn company profiles via Google search results through SerpAPI,
 * which is a permitted, third-party search aggregation service.
 *
 * For full LinkedIn API integration (CRM sync, InMail, etc.), configure the
 * LinkedIn OAuth credentials and a dedicated provider can be built later.
 */
export const linkedinProvider: LeadProvider = {
  id: 'linkedin',
  label: 'LinkedIn',
  sources: ['linkedin'] as LeadSource[],
  supportedParams: ['query', 'industry', 'location', 'country', 'limit'],

  isConfigured(): boolean {
    return Boolean(config.serpApiKey || getLeadCredentialSync('linkedin', 'apiKey'));
  },

  async search(params: LeadSearchParams): Promise<RawLead[]> {
    const apiKey = await resolveLeadApiKey('linkedin', config.serpApiKey);
    if (!apiKey) {
      throw new Error('LinkedIn search requires SERPAPI_KEY for compliant public data access.');
    }

    const locationParts = [params.city, params.state, params.country, params.location].filter(
      Boolean,
    );
    const siteQuery = params.industry
      ? `site:linkedin.com/company ${params.industry} ${locationParts.join(' ')}`
      : `site:linkedin.com/company ${params.query} ${locationParts.join(' ')}`;

    const url = new URL(SERP_API_URL);
    url.searchParams.set('engine', 'google');
    url.searchParams.set('q', siteQuery.trim());
    url.searchParams.set('api_key', apiKey);
    url.searchParams.set('num', String(Math.min(params.limit ?? 20, 50)));

    const data = await fetchJson<SerpApiLinkedInResponse>(url.toString(), {
      timeoutMs: REQUEST_TIMEOUT_MS,
    });

    if (data.error) {
      throw new Error(`LinkedIn search error: ${data.error}`);
    }

    const results: RawLead[] = [];

    for (const result of data.organic_results ?? []) {
      if (!result.link || !result.link.includes('linkedin.com')) continue;

      const title = result.title?.replace(/ \| LinkedIn.*$/, '').trim();
      if (!title) continue;

      const companyMatch = result.displayed_link
        ?.replace(/ › .*/, '')
        .replace(/^linkedin\.com\/company\//, '');

      results.push({
        companyName: companyMatch || title.split(' - ')[0]?.trim() || title,
        companyDescription: result.snippet?.replace(/<[^>]+>/g, '').trim(),
        linkedinUrl: result.link,
        website: undefined,
        source: 'linkedin',
        sourceId: result.link,
        sourceUrl: result.link,
        sourceData: {
          serpTitle: result.title,
          snippet: result.snippet,
          displayedLink: result.displayed_link,
          dataAccess: 'public_search',
          note: 'Data sourced from public LinkedIn profiles via web search.',
        },
      });
    }

    return results.slice(0, params.limit ?? 20);
  },

  async healthCheck() {
    const apiKey = await resolveLeadApiKey('linkedin', config.serpApiKey);
    if (!apiKey) {
      return { ok: false, message: 'SERPAPI_KEY required for LinkedIn public search' };
    }
    const start = Date.now();
    try {
      const url = new URL(SERP_API_URL);
      url.searchParams.set('engine', 'google');
      url.searchParams.set('q', 'site:linkedin.com/company technology');
      url.searchParams.set('api_key', apiKey);
      url.searchParams.set('num', '1');
      const data = await fetchJson<{ search_metadata?: { status?: number } }>(url.toString(), {
        timeoutMs: 8000,
      });
      return {
        ok: data.search_metadata?.status === 200,
        latencyMs: Date.now() - start,
      };
    } catch {
      return {
        ok: false,
        message: 'SerpAPI unreachable for LinkedIn search',
        latencyMs: Date.now() - start,
      };
    }
  },
};

import { fetchJson } from '../../lib/http.js';
import { config } from '../../config/index.js';
import type { LeadProvider, LeadSearchParams, LeadSource, RawLead } from '../types.js';

const SERP_API_URL = 'https://serpapi.com/search.json';
const REQUEST_TIMEOUT_MS = 12000;

type SerpOrganicResult = {
  title?: string;
  snippet?: string;
  link?: string;
  displayed_link?: string;
  domain?: string;
  position?: number;
  cached_page_link?: string;
  related_questions?: Array<{ question?: string; snippet?: string; link?: string }>;
};

type SerpLocalResult = {
  position?: number;
  title?: string;
  address?: string;
  rating?: number;
  reviews?: number;
  type?: string;
  phone?: string;
  website?: string;
  place_id?: string;
  coordinates?: { lat?: number; lng?: number };
};

type SerpApiWebSearchResponse = {
  search_metadata?: { status?: number; total_time?: number };
  organic_results?: SerpOrganicResult[];
  local_results?: SerpLocalResult[];
  knowledge_graph?: {
    title?: string;
    type?: string;
    website?: string;
    description?: string;
    source?: { link?: string; icon?: string };
    header_images?: Array<{ image?: string }>;
    facts?: Array<{ title?: string; value?: string }>;
  };
  answer_box?: { answer?: string; snippet?: string; title?: string; link?: string };
  error?: string;
};

function extractDomain(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return undefined;
  }
}

function normalizeOrganicResult(result: SerpOrganicResult, index: number): RawLead | null {
  const title = result.title?.trim();
  const link = result.link;
  if (!title || !link) return null;

  const domain = extractDomain(link) ?? result.domain;
  const snippet = result.snippet ?? '';

  const isLinkedIn = domain?.includes('linkedin.com');
  const isJobBoard =
    domain?.includes('indeed.com') ||
    domain?.includes('glassdoor.com') ||
    domain?.includes('ziprecruiter.com');

  return {
    companyName: title,
    companyDescription: snippet || undefined,
    website: link,
    linkedinUrl: isLinkedIn ? link : undefined,
    indeedUrl: isJobBoard ? link : undefined,
    source: 'web',
    sourceId: `web-${index}`,
    sourceUrl: link,
    sourceData: {
      domain,
      snippet,
      organicPosition: result.position,
      relatedQuestions: result.related_questions?.map((q) => ({
        question: q.question,
        snippet: q.snippet,
        link: q.link,
      })),
    },
  };
}

function normalizeLocalResult(result: SerpLocalResult): RawLead | null {
  const title = result.title?.trim();
  if (!title) return null;

  return {
    companyName: title,
    industry: result.type,
    phone: result.phone,
    address: result.address,
    website: result.website,
    rating: result.rating,
    reviewCount: result.reviews,
    source: 'web',
    sourceId: result.place_id,
    sourceUrl: result.website,
    sourceData: {
      placeId: result.place_id,
      coordinates: result.coordinates,
      localType: result.type,
    },
  };
}

export const webSearchProvider: LeadProvider = {
  id: 'web',
  label: 'Web Search',
  sources: ['web'] as LeadSource[],
  supportedParams: ['query', 'industry', 'location', 'country', 'city', 'state', 'limit'],

  isConfigured(): boolean {
    return Boolean(config.serpApiKey);
  },

  async search(params: LeadSearchParams): Promise<RawLead[]> {
    if (!config.serpApiKey) {
      throw new Error('Web search requires SERPAPI_KEY. Add it to your .env file or Settings.');
    }

    const locationParts = [params.city, params.state, params.country, params.location].filter(
      Boolean,
    );
    const query = [params.query || params.industry || '', ...locationParts]
      .filter(Boolean)
      .join(' ')
      .trim();

    const url = new URL(SERP_API_URL);
    url.searchParams.set('engine', 'google');
    url.searchParams.set('q', query);
    url.searchParams.set('api_key', config.serpApiKey);
    url.searchParams.set('num', String(params.limit ?? 20));

    const data = await fetchJson<SerpApiWebSearchResponse>(url.toString(), {
      timeoutMs: REQUEST_TIMEOUT_MS,
    });

    if (data.error) {
      throw new Error(`Web search error: ${data.error}`);
    }

    const results: RawLead[] = [];

    // Add local business results
    for (const local of data.local_results ?? []) {
      const lead = normalizeLocalResult(local);
      if (lead) results.push(lead);
    }

    // Add organic results
    for (const [index, organic] of (data.organic_results ?? []).entries()) {
      const lead = normalizeOrganicResult(organic, index);
      if (lead) results.push(lead);
    }

    // Add knowledge graph info if available
    if (data.knowledge_graph) {
      const kg = data.knowledge_graph;
      if (kg.title) {
        results.unshift({
          companyName: kg.title,
          companyDescription: kg.description,
          industry: kg.type,
          website: kg.website,
          source: 'web',
          sourceId: 'knowledge-graph',
          sourceData: {
            knowledgeGraph: {
              facts: kg.facts?.map((f) => ({ title: f.title, value: f.value })),
            },
          },
        });
      }
    }

    return results.slice(0, params.limit ?? 20);
  },

  async healthCheck() {
    if (!config.serpApiKey) {
      return { ok: false, message: 'SERPAPI_KEY not configured' };
    }
    const start = Date.now();
    try {
      const url = new URL(SERP_API_URL);
      url.searchParams.set('engine', 'google');
      url.searchParams.set('q', 'businesses');
      url.searchParams.set('api_key', config.serpApiKey);
      url.searchParams.set('num', '1');
      const data = await fetchJson<{ search_metadata?: { status?: number } }>(url.toString(), {
        timeoutMs: 8000,
      });
      return {
        ok: data.search_metadata?.status === 200,
        latencyMs: Date.now() - start,
      };
    } catch {
      return { ok: false, message: 'SerpAPI unreachable', latencyMs: Date.now() - start };
    }
  },
};

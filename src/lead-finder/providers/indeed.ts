import { fetchJson } from '../../lib/http.js';
import { config } from '../../config/index.js';
import type { LeadProvider, LeadSearchParams, LeadSource, RawLead } from '../types.js';

const INDEED_RSS_URL = 'https://www.indeed.com/rss';
const SERP_JOBS_URL = 'https://serpapi.com/search.json';
const REQUEST_TIMEOUT_MS = 10000;
const MAX_RESULTS = 20;

type RssItem = {
  title?: string;
  link?: string;
  description?: string;
  pubDate?: string;
};

type SerpApiJob = {
  title?: string;
  company_name?: string;
  location?: string;
  description?: string;
  detected_extensions?: {
    salary?: string;
    schedule_type?: string;
    remote?: boolean;
    posted_at?: string;
  };
  share_link?: string;
};

function parseRssItems(xml: string): RssItem[] {
  const items: RssItem[] = [];
  const regex = /<item>([\s\S]*?)<\/item>/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(xml)) !== null) {
    const block = match[1] ?? '';
    const title = extractTag(block, 'title');
    const link = extractTag(block, 'link');
    const description = extractTag(block, 'description');
    const pubDate = extractTag(block, 'pubDate');
    if (title && link) {
      items.push({ title, link, description: description ?? '', pubDate: pubDate ?? '' });
    }
  }
  return items;
}

function extractTag(block: string, tag: string): string | null {
  const regex = new RegExp(
    `<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tag}>|<${tag}[^>]*>([\\s\\S]*?)</${tag}>`,
  );
  const match = regex.exec(block);
  if (!match) return null;
  return (match[1] ?? match[2] ?? '').trim();
}

function parseIndeedTitle(raw: string): { title: string; company?: string; location?: string } {
  const parts = raw.split(' - ').map((p) => p.trim());
  if (parts.length >= 3)
    return { title: parts[0] ?? '', company: parts[1], location: parts.slice(2).join(', ') };
  if (parts.length === 2) return { title: parts[0] ?? '', company: parts[1] ?? undefined };
  return { title: raw };
}

function buildRssLead(item: RssItem): RawLead | null {
  const parsed = parseIndeedTitle(item.title ?? '');
  if (!parsed.title) return null;

  const [city, ...rest] = (parsed.location ?? '').split(',').map((s) => s.trim());
  const state = rest.length > 0 ? rest[0] : city;
  const country = rest.length > 1 ? rest[rest.length - 1] : undefined;

  return {
    companyName: parsed.company ?? 'Unknown Company',
    companyDescription: stripHtml(item.description ?? '').slice(0, 2000),
    city: city || undefined,
    state: country === 'UK' || country === 'USA' ? undefined : state || undefined,
    country,
    indeedUrl: item.link,
    source: 'indeed',
    sourceId: item.link,
    sourceUrl: item.link,
    sourceData: {
      jobTitle: parsed.title,
      postedAt: item.pubDate,
      method: 'rss',
    },
    hiringSignals: [parsed.title],
  };
}

function buildSerpJobLead(job: SerpApiJob): RawLead | null {
  const title = job.title?.trim();
  if (!title) return null;

  const [city, ...rest] = (job.location ?? '').split(',').map((s) => s.trim());
  const state = rest.length > 0 ? rest[0] : city;
  const country = rest.length > 1 ? rest[rest.length - 1] : undefined;

  return {
    companyName: job.company_name ?? 'Unknown Company',
    companyDescription: job.description?.slice(0, 2000),
    city: city || undefined,
    state: country === 'UK' || country === 'USA' ? undefined : state || undefined,
    country,
    indeedUrl: job.share_link,
    source: 'indeed',
    sourceId: job.share_link ?? `serpjobs-${title}`,
    sourceUrl: job.share_link,
    sourceData: {
      jobTitle: title,
      remote: job.detected_extensions?.remote,
      salary: job.detected_extensions?.salary,
      scheduleType: job.detected_extensions?.schedule_type,
      postedAt: job.detected_extensions?.posted_at,
      method: 'serpapi_google_jobs',
    },
    hiringSignals: [title],
  };
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Indeed/job-search provider. Uses SerpAPI's Google Jobs engine for richer
 * structured data, with Indeed RSS as a free fallback.
 *
 * Google Jobs aggregates from Indeed, LinkedIn, Glassdoor, ZipRecruiter, etc.
 */
export const indeedProvider: LeadProvider = {
  id: 'indeed',
  label: 'Indeed / Job Search',
  sources: ['indeed'] as LeadSource[],
  supportedParams: ['query', 'industry', 'location', 'city', 'state', 'country', 'limit'],

  isConfigured(): boolean {
    return true; // RSS works without API keys; SerpAPI is optional but better
  },

  async search(params: LeadSearchParams): Promise<RawLead[]> {
    const results: RawLead[] = [];
    const errors: string[] = [];

    // Primary: SerpAPI Google Jobs (richer data)
    if (config.serpApiKey) {
      try {
        const locationParts = [params.city, params.state, params.country, params.location].filter(
          Boolean,
        );
        const query = [params.query || params.industry || '', ...locationParts]
          .filter(Boolean)
          .join(' ')
          .trim();

        const url = new URL(SERP_JOBS_URL);
        url.searchParams.set('engine', 'google_jobs');
        url.searchParams.set('q', query || 'hiring');
        url.searchParams.set('api_key', config.serpApiKey);
        url.searchParams.set('hl', 'en');

        const data = await fetchJson<{ jobs_results?: SerpApiJob[]; error?: string }>(
          url.toString(),
          { timeoutMs: REQUEST_TIMEOUT_MS },
        );

        if (data.error) {
          errors.push(`SerpAPI jobs: ${data.error}`);
        } else {
          for (const job of data.jobs_results ?? []) {
            const lead = buildSerpJobLead(job);
            if (lead) results.push(lead);
          }
        }
      } catch (error) {
        errors.push(`SerpAPI jobs: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // Fallback: Indeed RSS (free, no API key)
    if (results.length === 0 || !config.serpApiKey) {
      try {
        const locationParts = [params.city, params.state, params.country, params.location].filter(
          Boolean,
        );
        const query = [params.query || params.industry || '', ...locationParts]
          .filter(Boolean)
          .join(' ')
          .trim();

        const rssUrl = `${INDEED_RSS_URL}?q=${encodeURIComponent(query)}&sort=date&limit=${MAX_RESULTS}`;
        const response = await fetch(rssUrl, {
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          headers: { 'User-Agent': 'BRO-Sales/1.0 (compatible; RSS reader)' },
        });
        if (!response.ok) {
          errors.push(`Indeed RSS returned HTTP ${response.status}`);
        } else {
          const xml = await response.text();
          for (const item of parseRssItems(xml)) {
            const lead = buildRssLead(item);
            if (lead) results.push(lead);
          }
        }
      } catch (error) {
        errors.push(`Indeed RSS: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (results.length === 0 && errors.length > 0) {
      throw new Error(errors.join('; '));
    }

    return results.slice(0, params.limit ?? MAX_RESULTS);
  },

  async healthCheck() {
    const start = Date.now();
    try {
      const response = await fetch(`${INDEED_RSS_URL}?q=test&limit=1`, {
        signal: AbortSignal.timeout(8000),
        headers: { 'User-Agent': 'BRO-Sales/1.0 (compatible; RSS reader)' },
      });
      return {
        ok: response.ok,
        latencyMs: Date.now() - start,
        message: response.ok ? 'RSS accessible' : `HTTP ${response.status}`,
      };
    } catch {
      return { ok: false, message: 'Indeed RSS unreachable', latencyMs: Date.now() - start };
    }
  },
};

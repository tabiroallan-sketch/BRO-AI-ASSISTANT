import { fetchJson } from '../../lib/http.js';
import { config } from '../../config/index.js';
import type {
  OpportunityCandidate,
  OpportunitySourceAdapter,
  SourceSearchResult,
} from './types.js';

const REQUEST_TIMEOUT_MS = 12000;
const MAX_RESULTS = 10;

type SerpApiJob = {
  title?: string;
  company_name?: string;
  location?: string;
  description?: string;
  extensions?: string[];
  detected_extensions?: {
    salary?: string;
    schedule_type?: string;
    remote?: boolean;
    posted_at?: string;
  };
  share_link?: string;
  related_links?: Array<{ link?: string; title?: string }>;
};

type SerpApiGoogleJobsResponse = {
  search_metadata?: { status?: number };
  jobs_results?: SerpApiJob[];
  error?: string;
};

function buildCandidate(job: SerpApiJob): OpportunityCandidate {
  const ext = job.detected_extensions ?? {};
  const shareUrl = job.share_link ?? job.related_links?.[0]?.link;
  const description = job.description ?? '';
  const skills = extractSkills(description, job.extensions ?? []);

  return {
    title: job.title ?? 'Untitled position',
    description: description.slice(0, 4000),
    company: job.company_name ?? undefined,
    source: 'serpapi-jobs',
    sourceReliability: 'MEDIUM',
    sourceUrl: shareUrl ?? undefined,
    location: job.location ?? undefined,
    remote: ext.remote ?? undefined,
    compensation: ext.salary ?? undefined,
    employmentType: ext.schedule_type ?? undefined,
    requiredSkills: skills.length > 0 ? skills : undefined,
    postedAt: ext.posted_at ?? undefined,
    rawContent: description.slice(0, 6000),
  };
}

function extractSkills(description: string, extensions: string[]): string[] {
  const combined = [...extensions, description].join(' ').toLowerCase();
  const knownSkills = [
    'javascript',
    'typescript',
    'python',
    'react',
    'nextjs',
    'next.js',
    'node.js',
    'nodejs',
    'vue',
    'angular',
    'svelte',
    'java',
    'c#',
    'csharp',
    'go',
    'golang',
    'rust',
    'ruby',
    'php',
    'swift',
    'kotlin',
    'flutter',
    'react native',
    'aws',
    'gcp',
    'azure',
    'docker',
    'kubernetes',
    'postgresql',
    'mysql',
    'mongodb',
    'redis',
    'graphql',
    'rest api',
    'html',
    'css',
    'tailwind',
    'figma',
    'photoshop',
    'illustrator',
    'seo',
    'google analytics',
    'salesforce',
    'hubspot',
    'wordpress',
    'shopify',
    'laravel',
    'django',
    'fastapi',
    'spring',
    '.net',
  ];
  return knownSkills.filter((skill) => combined.includes(skill));
}

/**
 * Searches for jobs via SerpAPI's Google Jobs engine. Google Jobs aggregates
 * listings from 20+ boards (Indeed, LinkedIn, Glassdoor, ZipRecruiter, etc.)
 * and returns structured JSON with source attribution.
 *
 * Requires SERPAPI_KEY env var. Free tier: 250 searches/month.
 */
export const serpApiJobsAdapter: OpportunitySourceAdapter = {
  id: 'serpapi-jobs',
  label: 'Google Jobs (SerpAPI)',
  supportsSearch: true,
  supportsFetchUrl: false,
  supportsCompanyWebsite: false,

  async search(query: string): Promise<SourceSearchResult> {
    const apiKey = config.serpApiKey;
    if (!apiKey) {
      return {
        candidates: [],
        errors: [
          { message: 'SERPAPI_KEY is not configured. Add it to enable Google Jobs search.' },
        ],
      };
    }

    const url = `https://serpapi.com/search.json?engine=google_jobs&q=${encodeURIComponent(query)}&api_key=${encodeURIComponent(apiKey)}&hl=en`;
    let data: SerpApiGoogleJobsResponse;
    try {
      data = await fetchJson<SerpApiGoogleJobsResponse>(url, {
        timeoutMs: REQUEST_TIMEOUT_MS,
      });
    } catch (error) {
      return {
        candidates: [],
        errors: [{ message: error instanceof Error ? error.message : String(error) }],
      };
    }

    if (data.error) {
      return {
        candidates: [],
        errors: [{ message: `SerpAPI error: ${data.error}` }],
      };
    }

    const jobs = data.jobs_results ?? [];
    const candidates: OpportunityCandidate[] = jobs.slice(0, MAX_RESULTS).map(buildCandidate);

    return { candidates, errors: [] };
  },

  async fetchUrl(): Promise<OpportunityCandidate | null> {
    return null;
  },

  async fetchCompanyWebsite(): Promise<SourceSearchResult> {
    return { candidates: [], errors: [] };
  },
};

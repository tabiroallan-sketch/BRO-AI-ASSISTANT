import { companyCareerAdapter } from './company-career.js';
import { webSearchAdapter } from './search.js';
import type { OpportunityCandidate, OpportunitySourceAdapter } from './types.js';
import { userSubmittedAdapter } from './user-submitted.js';

const adapters = new Map<string, OpportunitySourceAdapter>();

export function registerSourceAdapter(adapter: OpportunitySourceAdapter): void {
  adapters.set(adapter.id, adapter);
}

export function getSourceAdapter(id: string): OpportunitySourceAdapter | undefined {
  return adapters.get(id);
}

export function listSourceAdapters(): OpportunitySourceAdapter[] {
  return [...adapters.values()];
}

export function registerDefaultSourceAdapters(): void {
  registerSourceAdapter(userSubmittedAdapter);
  registerSourceAdapter(webSearchAdapter);
  registerSourceAdapter(companyCareerAdapter);
}

registerDefaultSourceAdapters();

export type DiscoverOptions = {
  query?: string;
  url?: string;
  companyWebsite?: string;
  sources?: string[];
  limit?: number;
};

export type DiscoverError = { source: string; message: string };

export type DiscoverResult = {
  candidates: OpportunityCandidate[];
  errors: DiscoverError[];
};

function candidateKey(candidate: OpportunityCandidate): string {
  const url = candidate.sourceUrl?.trim().toLowerCase();
  if (url) {
    return `url:${url}`;
  }
  const company = candidate.company?.trim().toLowerCase() ?? '';
  const title = candidate.title?.trim().toLowerCase() ?? '';
  return `${candidate.source}:${company}|${title}`;
}

export function deduplicateCandidates(candidates: OpportunityCandidate[]): OpportunityCandidate[] {
  const seen = new Set<string>();
  const unique: OpportunityCandidate[] = [];
  for (const candidate of candidates) {
    const key = candidateKey(candidate);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(candidate);
  }
  return unique;
}

export function classifyCandidate(candidate: OpportunityCandidate): {
  type: string;
  reason: string;
} {
  const haystack = [
    candidate.title,
    candidate.description,
    candidate.rawContent,
    candidate.employmentType,
    candidate.company,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  const jobHints = [
    'hiring',
    'job',
    'vacancy',
    'we are looking for',
    'we are hiring',
    'position',
    'role',
    'full-time',
    'part-time',
    'contractor',
    'freelance',
    'join our team',
  ];
  const rfpHints = [
    'rfp',
    'tender',
    'proposal',
    'request for proposal',
    'invitation to bid',
    'quote',
    'outsource',
    'outsourcing',
    'vendor',
  ];
  const clientHints = [
    'looking for a developer',
    'need a developer',
    'need a designer',
    'build a website',
    'build an app',
    'website for',
    'help with',
    'project',
  ];

  if (jobHints.some((hint) => haystack.includes(hint))) {
    return { type: 'JOB', reason: 'Job posting or hiring language detected' };
  }
  if (rfpHints.some((hint) => haystack.includes(hint))) {
    return { type: 'OUTSOURCING', reason: 'RFP, tender, or outsourcing language detected' };
  }
  if (clientHints.some((hint) => haystack.includes(hint))) {
    return {
      type: 'POTENTIAL_CLIENT',
      reason: 'Direct service request or project language detected',
    };
  }
  return { type: 'POTENTIAL_CLIENT', reason: 'No strong signal; defaulted to potential client' };
}

function applyLimit(candidates: OpportunityCandidate[], limit?: number): OpportunityCandidate[] {
  if (!limit || limit <= 0) {
    return candidates;
  }
  return candidates.slice(0, Math.min(limit, 50));
}

/**
 * Discovers opportunities from the requested sources and returns normalized,
 * de-duplicated candidates. Sources are opt-in, non-intrusive, and only touch
 * public endpoints or user-supplied data.
 */
export async function discoverOpportunities(options: DiscoverOptions): Promise<DiscoverResult> {
  const sourceIds = options.sources?.length
    ? options.sources
    : listSourceAdapters().map((adapter) => adapter.id);

  const results = await Promise.all(
    sourceIds.map(async (id) => {
      const adapter = getSourceAdapter(id);
      if (!adapter) {
        return {
          source: id,
          candidates: [] as OpportunityCandidate[],
          errors: [{ source: id, message: `Unknown source adapter: ${id}` }],
        };
      }
      const errors: DiscoverError[] = [];
      const candidates: OpportunityCandidate[] = [];
      if (options.url && adapter.supportsFetchUrl) {
        try {
          const candidate = await adapter.fetchUrl(options.url);
          if (candidate) {
            candidates.push(candidate);
          }
        } catch (error) {
          errors.push({
            source: id,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
      if (options.companyWebsite && adapter.supportsCompanyWebsite) {
        const result = await adapter.fetchCompanyWebsite(options.companyWebsite);
        candidates.push(...result.candidates);
        errors.push(...result.errors.map((error) => ({ source: id, message: error.message })));
      }
      if (options.query && adapter.supportsSearch) {
        const result = await adapter.search(options.query);
        candidates.push(...result.candidates);
        errors.push(...result.errors.map((error) => ({ source: id, message: error.message })));
      }
      return { source: id, candidates, errors };
    }),
  );

  const candidates = applyLimit(
    deduplicateCandidates(results.flatMap((result) => result.candidates)),
    options.limit,
  );
  const errors = results.flatMap((result) => result.errors).filter((error) => error.message);
  return { candidates, errors };
}

export type { OpportunityCandidate, OpportunitySourceAdapter } from './types.js';
export { normalizeUserSubmitted, type UserSubmittedInput } from './user-submitted.js';

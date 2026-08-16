/**
 * Opportunity source adapter contract. A source discovers raw opportunities
 * (jobs, RFPs, service needs) and normalizes them into a common structure.
 *
 * Safety: adapters must only use authorized access — official APIs, publicly
 * accessible pages, or user-provided URLs. No CAPTCHA bypassing, no stealth
 * scraping, no anti-bot evasion, no credential theft.
 */

export type OpportunityCandidate = {
  title: string;
  description?: string;
  company?: string;
  companyWebsite?: string;
  source: string;
  sourceReliability: 'HIGH' | 'MEDIUM' | 'LOW';
  sourceUrl?: string;
  location?: string;
  remote?: boolean;
  compensation?: string;
  currency?: string;
  employmentType?: string;
  requiredSkills?: string[];
  technologies?: string[];
  industry?: string;
  companySize?: string;
  clientName?: string;
  clientRole?: string;
  postedAt?: string;
  deadline?: string;
  estimatedBudget?: number;
  recurringPotential?: boolean;
  urgency?: string;
  rawContent?: string;
};

export type SourceSearchResult = {
  candidates: OpportunityCandidate[];
  errors: Array<{ message: string }>;
};

export interface OpportunitySourceAdapter {
  /** Stable identifier, e.g. "user-submitted", "web-search", "company-career". */
  readonly id: string;
  /** Human-readable label for the UI. */
  readonly label: string;
  /** Whether this adapter can run a keyword search. */
  readonly supportsSearch: boolean;
  /** Whether this adapter can fetch an opportunity from a single URL. */
  readonly supportsFetchUrl: boolean;
  /** Whether this adapter can research a company website (careers pages). */
  readonly supportsCompanyWebsite: boolean;

  /** Search for opportunities matching a query. May return zero candidates. */
  search(query: string): Promise<SourceSearchResult>;

  /** Fetch and normalize an opportunity from a specific URL. */
  fetchUrl(url: string): Promise<OpportunityCandidate | null>;

  /** Discover opportunities from a company website (careers pages). */
  fetchCompanyWebsite(website: string): Promise<SourceSearchResult>;
}

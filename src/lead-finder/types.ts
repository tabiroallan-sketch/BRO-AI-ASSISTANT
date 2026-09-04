export type LeadSource = 'google_maps' | 'linkedin' | 'indeed' | 'reddit' | 'web' | 'ai_extension';

export type ProviderStatus = 'connected' | 'not_configured' | 'error' | 'degraded';

export type ProviderHealthResult = {
  providerId: string;
  label: string;
  status: ProviderStatus;
  message?: string;
  latencyMs?: number;
};

export type LeadSearchParams = {
  query: string;
  industry?: string;
  location?: string;
  country?: string;
  city?: string;
  state?: string;
  employeeCountMin?: number;
  employeeCountMax?: number;
  ratingMin?: number;
  ratingMax?: number;
  sources?: LeadSource[];
  keywords?: string[];
  hiringSignals?: boolean;
  intentSignals?: boolean;
  limit?: number;
};

export type RawLead = {
  companyName: string;
  companyDescription?: string;
  industry?: string;
  website?: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  employeeCount?: number;
  rating?: number;
  reviewCount?: number;
  linkedinUrl?: string;
  googleMapsUrl?: string;
  redditUrl?: string;
  indeedUrl?: string;
  source: LeadSource;
  sourceId?: string;
  sourceUrl?: string;
  sourceData?: Record<string, unknown>;
  hiringSignals?: string[];
  intentSignals?: string[];
  painPoints?: string[];
  automationOpportunities?: string[];
};

export interface LeadProvider {
  readonly id: string;
  readonly label: string;
  readonly sources: LeadSource[];
  readonly supportedParams: Array<keyof LeadSearchParams>;

  isConfigured(): boolean;
  search(params: LeadSearchParams): Promise<RawLead[]>;
  healthCheck?(): Promise<{ ok: boolean; message?: string; latencyMs?: number }>;
}

export type ProviderSearchResult = {
  providerId: string;
  leads: RawLead[];
  error?: string;
  latencyMs: number;
};

export type NormalizedLead = RawLead & {
  normalizedCompanyName: string;
  domain?: string;
};

export type DedupedLead = RawLead & {
  sources: LeadSource[];
  sourceUrls: Record<string, string>;
  confidence: number;
};

export type LeadEnrichment = {
  summary: string;
  painPoints: Array<{ text: string; confidence: 'Verified' | 'Likely' | 'Inferred' | 'Unknown' }>;
  automationOpportunities: Array<{
    text: string;
    confidence: 'Verified' | 'Likely' | 'Inferred' | 'Unknown';
  }>;
  recommendation: string;
  recommendedApproach: string;
};

export type LeadScoreBreakdown = {
  total: number;
  reasons: string[];
};

export type LeadSearchResult = {
  leads: Array<{
    lead: RawLead;
    score: LeadScoreBreakdown;
    sources: LeadSource[];
    confidence: number;
    enriched?: LeadEnrichment;
  }>;
  errors: Array<{ providerId: string; message: string }>;
  durationMs: number;
};

export const ALL_SOURCES: LeadSource[] = ['google_maps', 'linkedin', 'indeed', 'reddit', 'web'];

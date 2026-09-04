import { ApiError, request } from '@/lib/api';
import { getAccessToken } from '@/lib/token-store';

export type LeadSource = 'google_maps' | 'linkedin' | 'indeed' | 'reddit' | 'web';

export type LeadProviderStatus = {
  id: string;
  label: string;
  description?: string;
  configured: boolean;
  apiKeyRequired: boolean;
};

export type CostEstimate = {
  currency: string;
  provider: string;
  estimate: number;
};

export type RawLeadResult = {
  providerId: string;
  leads: RawLead[];
  count: number;
  tookMs: number;
  error?: string;
  warnings: string[];
  costEstimate?: CostEstimate;
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
  hiringSignals?: string[];
  intentSignals?: string[];
  painPoints?: string[];
  automationOpportunities?: string[];
  source: LeadSource;
  sourceId?: string;
  sourceUrl?: string;
  sourceData?: Record<string, unknown>;
  confidence?: number;
  seasonal?: string;
  fundingRaised?: string;
  growth?: string;
  technologies?: string[];
};

export type DedupedLead = RawLead & {
  id: string;
  sources: LeadSource[];
  confidence: number;
  dedupeKey: string;
};

export type LeadScoreBreakdown = {
  total: number;
  signals: number;
  relevance: number;
  decisionPower: number;
  budget: number;
  technical: number;
  reasons: string[];
};

export type LeadEnrichment = {
  summary: string;
  painPoints: Array<{ text: string; confidence: string }>;
  automationOpportunities: Array<{ text: string; confidence: string }>;
  recommendation: string;
  recommendedApproach: string;
  score: LeadScoreBreakdown;
};

export type ScoredLead = {
  lead: DedupedLead;
  score: LeadScoreBreakdown;
  sources: LeadSource[];
  confidence: number;
  enriched?: LeadEnrichment;
};

export type LeadFinderSearchParams = {
  query: string;
  sources?: LeadSource[];
  industry?: string;
  location?: string;
  country?: string;
  city?: string;
  state?: string;
  employeeCountMin?: number;
  employeeCountMax?: number;
  ratingMin?: number;
  ratingMax?: number;
  keywords?: string[];
  hiringSignals?: boolean;
  intentSignals?: boolean;
  limit?: number;
  enrich?: boolean;
  parseNatural?: boolean;
};

export type LeadSearchHistory = {
  id: string;
  userId: string;
  query: string;
  sources: string[];
  resultCount: number;
  duration: number;
  errors: Array<{ provider: string; error: string }>;
  createdAt: string;
};

export type SavedLead = {
  id: string;
  companyName: string;
  companyDescription: string | null;
  industry: string | null;
  website: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  employeeCount: number | null;
  rating: number | null;
  reviewCount: number | null;
  linkedinUrl: string | null;
  googleMapsUrl: string | null;
  redditUrl: string | null;
  indeedUrl: string | null;
  source: string;
  hiringSignals: string[];
  intentSignals: string[];
  painPoints: string[];
  automationOpportunities: string[];
  leadScore: number;
  leadScoreReason: string[];
  status: string;
  notes: string | null;
  confidence: number | null;
  searchId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type OutreachMessage = {
  id?: string;
  channel: string;
  subject?: string;
  body: string;
};

function authToken(): string {
  const token = getAccessToken();
  if (!token) {
    throw new ApiError(401, 'Not authenticated');
  }
  return token;
}

export async function fetchLeadProviders(): Promise<LeadProviderStatus[]> {
  const result = await request<{ providers: LeadProviderStatus[] }>('/lead-finder/providers', {
    token: authToken(),
  });
  return result.providers;
}

export async function searchLeads(params: LeadFinderSearchParams): Promise<{
  leads: ScoredLead[];
  total: number;
  errors: Array<{ providerId: string; message: string }>;
  durationMs: number;
  searchId?: string;
}> {
  return request('/lead-finder/search', {
    method: 'POST',
    token: authToken(),
    body: params,
  });
}

export async function fetchLeadHistory(): Promise<LeadSearchHistory[]> {
  const result = await request<{ history: LeadSearchHistory[] }>('/lead-finder/history', {
    token: authToken(),
  });
  return result.history;
}

export async function saveLead(
  input: Partial<SavedLead> & { companyName: string },
): Promise<SavedLead> {
  const result = await request<{ lead: SavedLead }>('/lead-finder/leads', {
    method: 'POST',
    token: authToken(),
    body: input,
  });
  return result.lead;
}

export async function listSavedLeads(query?: {
  status?: string;
  industry?: string;
  source?: string;
  minScore?: number;
  searchId?: string;
  sort?: string;
  order?: string;
  page?: number;
  pageSize?: number;
}): Promise<{ leads: SavedLead[]; total: number; page: number; pageSize: number }> {
  const params = new URLSearchParams();
  if (query?.status) params.set('status', query.status);
  if (query?.industry) params.set('industry', query.industry);
  if (query?.source) params.set('source', query.source);
  if (query?.minScore !== undefined) params.set('minScore', String(query.minScore));
  if (query?.searchId) params.set('searchId', query.searchId);
  if (query?.sort) params.set('sort', query.sort);
  if (query?.order) params.set('order', query.order);
  if (query?.page) params.set('page', String(query.page));
  if (query?.pageSize) params.set('pageSize', String(query.pageSize));
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return request<{ leads: SavedLead[]; total: number; page: number; pageSize: number }>(
    `/lead-finder/leads${suffix}`,
    { token: authToken() },
  );
}

export async function getSavedLead(id: string): Promise<SavedLead> {
  const result = await request<{ lead: SavedLead }>(`/lead-finder/leads/${id}`, {
    token: authToken(),
  });
  return result.lead;
}

export async function updateSavedLead(id: string, input: Partial<SavedLead>): Promise<SavedLead> {
  const result = await request<{ lead: SavedLead }>(`/lead-finder/leads/${id}`, {
    method: 'PATCH',
    token: authToken(),
    body: input,
  });
  return result.lead;
}

export async function deleteSavedLead(id: string): Promise<void> {
  await request<void>(`/lead-finder/leads/${id}`, {
    method: 'DELETE',
    token: authToken(),
  });
}

export async function enrichSavedLead(
  id: string,
  providerId?: string,
): Promise<{ lead: SavedLead; enrichment: LeadEnrichment }> {
  return request<{ lead: SavedLead; enrichment: LeadEnrichment }>(
    `/lead-finder/leads/${id}/enrich`,
    {
      method: 'POST',
      token: authToken(),
      body: { providerId },
    },
  );
}

export async function generateLeadOutreach(
  id: string,
  input: {
    channel?: string;
    tone?: string;
    context?: string;
    channels?: string[];
  },
): Promise<{ outreach: OutreachMessage[] }> {
  return request<{ outreach: OutreachMessage[] }>(`/lead-finder/leads/${id}/outreach`, {
    method: 'POST',
    token: authToken(),
    body: input,
  });
}

export async function exportLeads(format: 'csv' | 'json'): Promise<string> {
  const result = await request<unknown>('/lead-finder/export', {
    method: 'POST',
    token: authToken(),
    body: { format },
  });
  return JSON.stringify(result);
}

import { ApiError, request } from '@/lib/api';
import { getAccessToken } from '@/lib/token-store';

export type OpportunityType =
  'JOB' | 'POTENTIAL_CLIENT' | 'OUTSOURCING' | 'PARTNERSHIP' | 'RECURRING';
export type OpportunityStatus = 'NEW' | 'EVALUATING' | 'PROPOSED' | 'WON' | 'LOST';
export type LeadStatus =
  | 'NEW'
  | 'QUALIFIED'
  | 'CONTACTED'
  | 'RESPONDED'
  | 'MEETING'
  | 'PROPOSAL'
  | 'NEGOTIATION'
  | 'WON'
  | 'LOST';
export type OfferStatus = 'DRAFT' | 'SENT' | 'ACCEPTED' | 'DECLINED';

export type SalesOverview = {
  pipelineValue: number;
  leads: number;
  opportunities: number;
  highPriorityOpportunities: number;
  followUpsDue: number;
  dealsWon: number;
  dealsLost: number;
  conversionRate: number;
  byStage: Record<LeadStatus, number>;
};

export type Opportunity = {
  id: string;
  title: string;
  description: string | null;
  company: string | null;
  companyWebsite: string | null;
  source: string | null;
  sourceUrl: string | null;
  location: string | null;
  remote: boolean;
  compensation: string | null;
  currency: string;
  employmentType: string | null;
  requiredSkills: string[];
  technologies: string[];
  estimatedBudget: number | null;
  industry: string | null;
  companySize: string | null;
  clientName: string | null;
  clientRole: string | null;
  postedAt: string | null;
  deadline: string | null;
  recurringPotential: boolean;
  sourceReliability: string | null;
  urgency: string | null;
  type: OpportunityType;
  score: number;
  status: OpportunityStatus;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Lead = {
  id: string;
  name: string;
  company: string | null;
  position: string | null;
  email: string | null;
  phone: string | null;
  source: string | null;
  status: LeadStatus;
  estimatedValue: number | null;
  probability: number;
  nextFollowUpAt: string | null;
  lastContactAt: string | null;
};

export type Offer = {
  id: string;
  userId: string;
  opportunityId: string | null;
  leadId: string | null;
  name: string;
  description: string | null;
  components: string[];
  suggestedPrice: number | null;
  minimumPrice: number | null;
  targetMargin: number;
  currency: string;
  deliveryEstimate: string | null;
  validDays: number;
  status: OfferStatus;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DiscoverySource = {
  id: string;
  label: string;
  supportsSearch: boolean;
  supportsFetchUrl: boolean;
  supportsCompanyWebsite: boolean;
};

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
  requiredSkills?: string[];
  technologies?: string[];
  estimatedBudget?: number;
  industry?: string;
  urgency?: string;
  type: string;
  typeReason: string;
  postedAt?: string;
  employmentType?: string;
};

export type Persona = {
  title: string;
  summary: string;
  role: string;
  likelyGoals: string[];
  likelyChallenges: string[];
  buyingDrivers: string[];
  decisionStyle: string;
  preferredChannel: string;
  communicationTips: string[];
  signalsObserved: string[];
  warnings: string[];
};

export type DesignedOffer = {
  name: string;
  description: string;
  components: string[];
  suggestedPrice: number;
  minimumPrice: number;
  targetMargin: number;
  currency: string;
  deliveryEstimate: string;
  validDays: number;
  rationale: string;
  warnings: string[];
};

export type ObjectionPlaybook = {
  objections: Array<{ objection: string; response: string }>;
  signalsToWatchFor: string[];
  preparationNotes: string[];
};

export type NegotiationStrategy = {
  strategy: string;
  anchors: { opening: string; target: string; walkAway: string; rationale: string };
  concessions: Array<{ give: string; getInReturn: string }>;
  tactics: string[];
  redFlags: string[];
  nextSteps: string[];
};

export type MarginAnalysis = {
  minimumPrice: number;
  targetPrice: number;
  targetMargin: number;
  estimatedCost: number;
  estimatedMargin: number;
  estimatedMarginPercent: number;
  status: 'healthy' | 'thin' | 'at-risk';
  currency: string;
  notes: string[];
};

function authToken(): string {
  const token = getAccessToken();
  if (!token) {
    throw new ApiError(401, 'Not authenticated');
  }
  return token;
}

export async function fetchSalesOverview(): Promise<SalesOverview> {
  const result = await request<{ overview: SalesOverview }>('/sales/overview', {
    token: authToken(),
  });
  return result.overview;
}

export async function listOpportunities(query?: {
  status?: string;
  minScore?: number;
}): Promise<Opportunity[]> {
  const params = new URLSearchParams();
  if (query?.status) {
    params.set('status', query.status);
  }
  if (query?.minScore !== undefined) {
    params.set('minScore', String(query.minScore));
  }
  const suffix = params.toString() ? `?${params.toString()}` : '';
  const result = await request<{ opportunities: Opportunity[] }>(`/sales/opportunities${suffix}`, {
    token: authToken(),
  });
  return result.opportunities;
}

export async function createOpportunity(
  input: Partial<Opportunity> & { title: string },
): Promise<{ opportunity: Opportunity; score: { score: number } }> {
  return request<{ opportunity: Opportunity; score: { score: number } }>('/sales/opportunities', {
    method: 'POST',
    token: authToken(),
    body: input,
  });
}

export async function updateOpportunity(
  id: string,
  input: Partial<Opportunity>,
): Promise<Opportunity> {
  const result = await request<{ opportunity: Opportunity }>(`/sales/opportunities/${id}`, {
    method: 'PATCH',
    token: authToken(),
    body: input,
  });
  return result.opportunity;
}

export async function deleteOpportunity(id: string): Promise<void> {
  await request<void>(`/sales/opportunities/${id}`, {
    method: 'DELETE',
    token: authToken(),
  });
}

export async function fetchDiscoverySources(): Promise<DiscoverySource[]> {
  const result = await request<{ sources: DiscoverySource[] }>('/sales/discover/sources', {
    token: authToken(),
  });
  return result.sources;
}

export async function discoverOpportunities(input: {
  query?: string;
  url?: string;
  companyWebsite?: string;
  sources?: string[];
  limit?: number;
  save?: boolean;
}): Promise<{
  candidates: OpportunityCandidate[];
  savedCount: number;
  errors: Array<{ source: string; message: string }>;
}> {
  return request('/sales/discover', { method: 'POST', token: authToken(), body: input });
}

export async function submitOpportunity(
  input: Partial<Opportunity> & { title: string },
): Promise<{ opportunity: Opportunity; type: string; typeReason: string }> {
  return request('/sales/discover/submit', {
    method: 'POST',
    token: authToken(),
    body: input,
  });
}

export async function listOffers(): Promise<Offer[]> {
  const result = await request<{ offers: Offer[] }>('/sales/offers', { token: authToken() });
  return result.offers;
}

export async function createOffer(input: Partial<Offer> & { name: string }): Promise<Offer> {
  const result = await request<{ offer: Offer }>('/sales/offers', {
    method: 'POST',
    token: authToken(),
    body: input,
  });
  return result.offer;
}

export async function updateOffer(id: string, input: Partial<Offer>): Promise<Offer> {
  const result = await request<{ offer: Offer }>(`/sales/offers/${id}`, {
    method: 'PATCH',
    token: authToken(),
    body: input,
  });
  return result.offer;
}

export async function deleteOffer(id: string): Promise<void> {
  await request<void>(`/sales/offers/${id}`, {
    method: 'DELETE',
    token: authToken(),
  });
}

export async function designOffer(input: {
  companyName?: string;
  researchId?: string;
  opportunityId?: string;
  opportunityDescription?: string;
  context?: string;
}): Promise<DesignedOffer> {
  const result = await request<{ offer: DesignedOffer }>('/sales/offers/design', {
    method: 'POST',
    token: authToken(),
    body: input,
  });
  return result.offer;
}

export async function buildPersona(input: {
  companyName?: string;
  researchId?: string;
  opportunityId?: string;
  context?: string;
}): Promise<Persona> {
  const result = await request<{ persona: Persona }>('/sales/persona', {
    method: 'POST',
    token: authToken(),
    body: input,
  });
  return result.persona;
}

export async function prepareObjections(input: {
  companyName?: string;
  researchId?: string;
  opportunityId?: string;
  offer?: string;
  price?: string;
  context?: string;
}): Promise<ObjectionPlaybook> {
  const result = await request<{ objections: ObjectionPlaybook }>('/sales/objections', {
    method: 'POST',
    token: authToken(),
    body: input,
  });
  return result.objections;
}

export async function buildNegotiationStrategy(input: {
  companyName?: string;
  researchId?: string;
  opportunityId?: string;
  offer?: string;
  minimumPrice?: number;
  targetPrice?: number;
  currency?: string;
  context?: string;
}): Promise<NegotiationStrategy> {
  const result = await request<{ strategy: NegotiationStrategy }>('/sales/negotiation', {
    method: 'POST',
    token: authToken(),
    body: input,
  });
  return result.strategy;
}

export async function analyzeMargin(input: {
  minimumPrice?: number;
  targetPrice?: number;
  targetMargin?: number;
  estimatedCost?: number;
  currency?: string;
}): Promise<MarginAnalysis> {
  const result = await request<{ analysis: MarginAnalysis }>('/sales/margin', {
    method: 'POST',
    token: authToken(),
    body: input,
  });
  return result.analysis;
}

export type DraftStatus = 'DRAFT' | 'APPROVED' | 'SENT' | 'REJECTED';

export type Draft = {
  id: string;
  userId: string;
  kind: string;
  channel: string;
  leadId: string | null;
  opportunityId: string | null;
  recipientName: string | null;
  recipientEmail: string | null;
  subject: string | null;
  content: string;
  status: DraftStatus;
  error: string | null;
  approvedAt: string | null;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PitchResult = {
  subject: string;
  body: string;
};

export type NextBestAction = {
  action: string;
  why: string;
  priority: 'high' | 'medium' | 'low';
  timing: string;
  channel: string;
};

export async function listLeads(query?: { status?: string }): Promise<Lead[]> {
  const params = new URLSearchParams();
  if (query?.status) {
    params.set('status', query.status);
  }
  const suffix = params.toString() ? `?${params.toString()}` : '';
  const result = await request<{ leads: Lead[] }>(`/sales/leads${suffix}`, {
    token: authToken(),
  });
  return result.leads;
}

export async function createLead(input: Partial<Lead> & { name: string }): Promise<Lead> {
  const result = await request<{ lead: Lead }>('/sales/leads', {
    method: 'POST',
    token: authToken(),
    body: input,
  });
  return result.lead;
}

export async function updateLead(id: string, input: Partial<Lead>): Promise<Lead> {
  const result = await request<{ lead: Lead }>(`/sales/leads/${id}`, {
    method: 'PATCH',
    token: authToken(),
    body: input,
  });
  return result.lead;
}

export async function deleteLead(id: string): Promise<void> {
  await request<void>(`/sales/leads/${id}`, {
    method: 'DELETE',
    token: authToken(),
  });
}

export async function getNextBestAction(leadId: string, context?: string): Promise<NextBestAction> {
  const result = await request<{ action: NextBestAction }>(`/sales/leads/${leadId}/next-action`, {
    method: 'POST',
    token: authToken(),
    body: { context },
  });
  return result.action;
}

export async function listDrafts(status?: string): Promise<Draft[]> {
  const params = new URLSearchParams();
  if (status) {
    params.set('status', status);
  }
  const suffix = params.toString() ? `?${params.toString()}` : '';
  const result = await request<{ drafts: Draft[] }>(`/sales/drafts${suffix}`, {
    token: authToken(),
  });
  return result.drafts;
}

export async function createDraft(input: Partial<Draft> & { content: string }): Promise<Draft> {
  const result = await request<{ draft: Draft }>('/sales/drafts', {
    method: 'POST',
    token: authToken(),
    body: input,
  });
  return result.draft;
}

export async function updateDraft(id: string, input: Partial<Draft>): Promise<Draft> {
  const result = await request<{ draft: Draft }>(`/sales/drafts/${id}`, {
    method: 'PATCH',
    token: authToken(),
    body: input,
  });
  return result.draft;
}

export async function deleteDraft(id: string): Promise<void> {
  await request<void>(`/sales/drafts/${id}`, {
    method: 'DELETE',
    token: authToken(),
  });
}

export async function approveDraft(id: string): Promise<Draft> {
  const result = await request<{ draft: Draft }>(`/sales/drafts/${id}/approve`, {
    method: 'POST',
    token: authToken(),
  });
  return result.draft;
}

export async function sendDraft(id: string): Promise<{ draft: Draft; messageId: string }> {
  return request<{ draft: Draft; messageId: string }>(`/sales/drafts/${id}/send`, {
    method: 'POST',
    token: authToken(),
  });
}

export async function generatePitch(input: {
  kind: string;
  company: string;
  recipientName?: string;
  recipientTitle?: string;
  opportunityDescription?: string;
  serviceName?: string;
  suggestedPrice?: string;
  context?: string;
  tone?: string;
  researchId?: string;
}): Promise<PitchResult> {
  const result = await request<{ pitch: PitchResult }>('/sales/pitch', {
    method: 'POST',
    token: authToken(),
    body: input,
  });
  return result.pitch;
}

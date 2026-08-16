export type OpportunityTypeValue =
  'JOB' | 'POTENTIAL_CLIENT' | 'OUTSOURCING' | 'PARTNERSHIP' | 'RECURRING';

export type OpportunityStatusValue = 'NEW' | 'EVALUATING' | 'PROPOSED' | 'WON' | 'LOST';

export type LeadStatusValue =
  | 'NEW'
  | 'QUALIFIED'
  | 'CONTACTED'
  | 'RESPONDED'
  | 'MEETING'
  | 'PROPOSAL'
  | 'NEGOTIATION'
  | 'WON'
  | 'LOST';

export type SalesDraftKindValue =
  'COLD_EMAIL' | 'LINKEDIN' | 'JOB_APPLICATION' | 'FOLLOW_UP' | 'PROPOSAL';

export type DraftStatusValue = 'DRAFT' | 'APPROVED' | 'SENT' | 'REJECTED';

export const OPPORTUNITY_TYPES: OpportunityTypeValue[] = [
  'JOB',
  'POTENTIAL_CLIENT',
  'OUTSOURCING',
  'PARTNERSHIP',
  'RECURRING',
];

export const OPPORTUNITY_STATUSES: OpportunityStatusValue[] = [
  'NEW',
  'EVALUATING',
  'PROPOSED',
  'WON',
  'LOST',
];

export const LEAD_STATUSES: LeadStatusValue[] = [
  'NEW',
  'QUALIFIED',
  'CONTACTED',
  'RESPONDED',
  'MEETING',
  'PROPOSAL',
  'NEGOTIATION',
  'WON',
  'LOST',
];

export const SALES_DRAFT_KINDS: SalesDraftKindValue[] = [
  'COLD_EMAIL',
  'LINKEDIN',
  'JOB_APPLICATION',
  'FOLLOW_UP',
  'PROPOSAL',
];

export const DRAFT_STATUSES: DraftStatusValue[] = ['DRAFT', 'APPROVED', 'SENT', 'REJECTED'];

/** Confidence levels used by company research. Never fabricate information. */
export type ResearchConfidence = 'KNOWN' | 'INFERRED' | 'ESTIMATED' | 'UNKNOWN';

export type ResearchItem = {
  confidence: ResearchConfidence;
  value: string;
  evidence?: string;
};

export type CompanyResearchResult = {
  companyName?: string;
  website?: string;
  industry?: ResearchItem;
  whatTheyDo?: ResearchItem;
  productsServices?: ResearchItem[];
  targetCustomers?: ResearchItem[];
  recentSignals?: ResearchItem[];
  painPoints?: ResearchItem[];
  automationOpportunities?: ResearchItem[];
  websiteMarketingOpportunities?: ResearchItem[];
  decisionMakers?: ResearchItem[];
  suggestedService?: ResearchItem;
  summary?: string;
  warnings?: string[];
};

/** Inputs accepted by the deterministic opportunity scorer. */
export type OpportunityScoreInput = {
  type?: OpportunityTypeValue;
  status?: OpportunityStatusValue;
  estimatedBudget?: number | string | null;
  industry?: string | null;
  urgency?: string | null;
  source?: string | null;
  requiredSkills?: string[];
  userSkills?: string[];
  skillFit?: number;
  budget?: number;
  profitPotential?: number;
  clientQuality?: number;
  urgencyRating?: number;
  recurringPotential?: number;
  winProbability?: number;
};

/** Configurable weights; all values are ratings on a 0-10 scale. */
export type ScoreWeights = {
  skillFit: number;
  budget: number;
  profitPotential: number;
  clientQuality: number;
  urgency: number;
  recurringPotential: number;
  winProbability: number;
};

export type ScoreBreakdown = {
  skillFit: { rating: number; weight: number; contribution: number };
  budget: { rating: number; weight: number; contribution: number };
  profitPotential: { rating: number; weight: number; contribution: number };
  clientQuality: { rating: number; weight: number; contribution: number };
  urgency: { rating: number; weight: number; contribution: number };
  recurringPotential: { rating: number; weight: number; contribution: number };
  winProbability: { rating: number; weight: number; contribution: number };
};

export type ScoreResult = {
  score: number;
  breakdown: ScoreBreakdown;
  weights: ScoreWeights;
};

export type SalesOverview = {
  pipelineValue: number;
  leads: number;
  opportunities: number;
  highPriorityOpportunities: number;
  followUpsDue: number;
  dealsWon: number;
  dealsLost: number;
  conversionRate: number;
  byStage: Record<LeadStatusValue, number>;
};

export type ServiceLike = {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  pricing: string | null;
  minimumPrice: number | string | null;
  targetMargin: number;
  requiredSkills: string[];
  deliveryEstimate: string | null;
  upsells: string[];
  recurringServices: string[];
  active: boolean;
  sortOrder: number;
};

export type PriceEstimate = {
  minimumPrice: number;
  suggestedPrice: number;
  targetMargin: number;
  currency: string;
};

export type LeadLike = {
  id: string;
  userId: string;
  name: string;
  company: string | null;
  position: string | null;
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  website: string | null;
  source: string | null;
  opportunityId: string | null;
  score: number;
  status: LeadStatusValue;
  estimatedValue: number | string | null;
  probability: number;
  lastContactAt: Date | string | null;
  nextFollowUpAt: Date | string | null;
  notes: string | null;
  createdAt?: Date | string;
};

export type NextBestAction = {
  action: string;
  why: string;
  priority: 'high' | 'medium' | 'low';
  timing: string;
  channel: string;
};

export type ProspectAnalysis = {
  summary: string;
  problems: string[];
  buyingSignals: string[];
  needsService: string[];
  decisionMakers: string[];
  recommendedOffer: {
    service: string;
    rationale: string;
    suggestedPrice?: string;
  };
  approach: {
    strategy: string;
    channel: string;
    messageHook: string;
  };
  objections: Array<{ objection: string; response: string }>;
  nextBestAction: NextBestAction;
};

/** Buyer persona for a specific prospect/opportunity. */
export type PersonaProfile = {
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

/** An offer designed for a specific opportunity. */
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

/** Objection-handling playbook for a deal. */
export type ObjectionPlaybook = {
  objections: Array<{ objection: string; response: string }>;
  signalsToWatchFor: string[];
  preparationNotes: string[];
};

/** Negotiation strategy for a specific deal. */
export type NegotiationStrategy = {
  strategy: string;
  anchors: {
    opening: string;
    target: string;
    walkAway: string;
    rationale: string;
  };
  concessions: Array<{ give: string; getInReturn: string }>;
  tactics: string[];
  redFlags: string[];
  nextSteps: string[];
};

/** Deterministic margin analysis for a service or offer. */
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

import type {
  OpportunityCandidate,
  OpportunitySourceAdapter,
  SourceSearchResult,
} from './types.js';

export type UserSubmittedInput = {
  title: string;
  description?: string;
  company?: string;
  companyWebsite?: string;
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

/**
 * Accepts opportunities the user provides directly: pasted job posts, RFPs,
 * or structured details. The most reliable source because the user saw the
 * original. Normalization is a pass-through plus mild field cleanup.
 */
export const userSubmittedAdapter: OpportunitySourceAdapter = {
  id: 'user-submitted',
  label: 'User submitted',
  supportsSearch: false,
  supportsFetchUrl: false,
  supportsCompanyWebsite: false,

  async search(): Promise<SourceSearchResult> {
    return { candidates: [], errors: [] };
  },

  async fetchUrl(): Promise<OpportunityCandidate | null> {
    return null;
  },

  async fetchCompanyWebsite(): Promise<SourceSearchResult> {
    return { candidates: [], errors: [] };
  },
};

export function normalizeUserSubmitted(input: UserSubmittedInput): OpportunityCandidate {
  const skills = (input.requiredSkills ?? []).map((skill) => skill.trim()).filter(Boolean);
  const techs = (input.technologies ?? []).map((tech) => tech.trim()).filter(Boolean);
  return {
    title: input.title.trim(),
    description: input.description?.trim() || undefined,
    company: input.company?.trim() || undefined,
    companyWebsite: input.companyWebsite?.trim() || undefined,
    source: 'user-submitted',
    sourceReliability: 'HIGH',
    sourceUrl: input.sourceUrl?.trim() || undefined,
    location: input.location?.trim() || undefined,
    remote: input.remote ?? false,
    compensation: input.compensation?.trim() || undefined,
    currency: input.currency?.trim() || undefined,
    employmentType: input.employmentType?.trim() || undefined,
    requiredSkills: skills,
    technologies: techs,
    industry: input.industry?.trim() || undefined,
    companySize: input.companySize?.trim() || undefined,
    clientName: input.clientName?.trim() || undefined,
    clientRole: input.clientRole?.trim() || undefined,
    postedAt: input.postedAt || undefined,
    deadline: input.deadline || undefined,
    estimatedBudget: input.estimatedBudget,
    recurringPotential: input.recurringPotential ?? false,
    urgency: input.urgency?.trim() || undefined,
    rawContent: input.rawContent?.trim() || undefined,
  };
}

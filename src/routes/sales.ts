import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { HttpError, requireAuth } from '../lib/auth.js';
import { recordAudit, type AuditAction } from '../lib/audit.js';
import { prisma } from '../lib/prisma.js';
import { estimatePrice, listServices, seedDefaultServices } from '../sales/catalog.js';
import { isAiConfigured } from '../sales/llm.js';
import { nextBestAction } from '../sales/next-best-action.js';
import { analyzeMargin } from '../sales/margin.js';
import { buildNegotiationStrategy } from '../sales/negotiation.js';
import { prepareObjections } from '../sales/objections.js';
import { designOffer, loadCatalogForOffer } from '../sales/offers.js';
import { buildPersona } from '../sales/persona.js';
import {
  OutreachError,
  assertCanApprove,
  assertCanEdit,
  sendEmailDraft,
} from '../sales/outreach.js';
import { canTransitionLeadStatus } from '../sales/pipeline.js';
import { generatePitch } from '../sales/pitch.js';
import { analyzeProspect } from '../sales/intelligence.js';
import { researchCompany } from '../sales/research.js';
import { scoreOpportunity } from '../sales/scoring.js';
import {
  classifyCandidate,
  discoverOpportunities,
  listSourceAdapters,
  normalizeUserSubmitted,
} from '../sales/sources/index.js';
import type { OpportunityCandidate } from '../sales/sources/types.js';
import {
  DRAFT_STATUSES,
  LEAD_STATUSES,
  OPPORTUNITY_STATUSES,
  OPPORTUNITY_TYPES,
  SALES_DRAFT_KINDS,
  type CompanyResearchResult,
  type LeadLike,
  type LeadStatusValue,
} from '../sales/types.js';

const PITCH_KIND_ENUM = z.enum([
  'COLD_EMAIL',
  'LINKEDIN',
  'JOB_APPLICATION',
  'FOLLOW_UP',
  'PROPOSAL',
]);

function stringEnum<T extends string>(values: readonly T[]): z.ZodEnum<[T, ...T[]]> {
  return z.enum(values as [T, ...T[]]);
}

const OPPORTUNITY_TYPE_ENUM = stringEnum(OPPORTUNITY_TYPES);
const OPPORTUNITY_STATUS_ENUM = stringEnum(OPPORTUNITY_STATUSES);
const LEAD_STATUS_ENUM = stringEnum(LEAD_STATUSES);
const DRAFT_KIND_ENUM = stringEnum(SALES_DRAFT_KINDS);

function requireUserId(request: FastifyRequest): string {
  const userId = request.user?.id;
  if (!userId) {
    throw new HttpError(401, 'Unauthorized');
  }
  return userId;
}

function salesAudit(
  request: FastifyRequest,
  action: AuditAction,
  target?: string,
  detail?: unknown,
): void {
  recordAudit({
    actorId: request.user?.id,
    actorEmail: request.user?.email,
    action,
    ...(target ? { target } : {}),
    ...(detail !== undefined ? { detail: JSON.stringify(detail) } : {}),
    ip: request.ip,
  });
}

function rethrowOutreachError(error: unknown): never {
  if (error instanceof OutreachError) {
    if (error.code === 'NOT_FOUND') {
      throw new HttpError(404, error.message);
    }
    throw new HttpError(400, error.message);
  }
  throw error;
}

function money(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { toNumber?: unknown }).toNumber === 'function'
  ) {
    return (value as { toNumber: () => number }).toNumber();
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function serviceResponse(
  service: Record<string, unknown> & { minimumPrice?: unknown },
): Record<string, unknown> {
  return {
    ...service,
    minimumPrice: money(service.minimumPrice),
  };
}

function opportunityResponse(
  opportunity: Record<string, unknown> & { estimatedBudget?: unknown },
): Record<string, unknown> {
  return {
    ...opportunity,
    estimatedBudget: money(opportunity.estimatedBudget),
  };
}

function leadResponse(
  lead: Record<string, unknown> & { estimatedValue?: unknown },
): Record<string, unknown> {
  return {
    ...lead,
    estimatedValue: money(lead.estimatedValue),
  };
}

function draftResponse(draft: Record<string, unknown>): Record<string, unknown> {
  return { ...draft };
}

const createServiceSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  pricing: z.string().trim().max(500).optional(),
  minimumPrice: z.number().min(0).optional(),
  targetMargin: z.number().int().min(0).max(90).optional(),
  requiredSkills: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
  deliveryEstimate: z.string().trim().max(200).optional(),
  upsells: z.array(z.string().trim().min(1).max(200)).max(50).optional(),
  recurringServices: z.array(z.string().trim().min(1).max(200)).max(50).optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
});

const updateServiceSchema = createServiceSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update',
  });

const createOpportunitySchema = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().trim().max(4000).optional(),
  company: z.string().trim().max(300).optional(),
  companyWebsite: z.string().trim().max(1000).optional(),
  source: z.string().trim().max(300).optional(),
  sourceUrl: z.string().trim().url().max(1000).optional(),
  location: z.string().trim().max(300).optional(),
  remote: z.boolean().optional(),
  compensation: z.string().trim().max(300).optional(),
  currency: z.string().trim().max(10).optional(),
  employmentType: z.string().trim().max(100).optional(),
  requiredSkills: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
  technologies: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
  estimatedBudget: z.number().min(0).optional(),
  industry: z.string().trim().max(200).optional(),
  companySize: z.string().trim().max(100).optional(),
  clientName: z.string().trim().max(300).optional(),
  clientRole: z.string().trim().max(200).optional(),
  postedAt: z.string().datetime().optional(),
  deadline: z.string().datetime().optional(),
  recurringPotential: z.boolean().optional(),
  sourceReliability: z.string().trim().max(20).optional(),
  rawContent: z.string().trim().max(12000).optional(),
  urgency: z.string().trim().max(300).optional(),
  type: OPPORTUNITY_TYPE_ENUM.optional(),
  status: OPPORTUNITY_STATUS_ENUM.optional(),
  notes: z.string().trim().max(4000).optional(),
});

const updateOpportunitySchema = createOpportunitySchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update',
  });

const createLeadSchema = z.object({
  name: z.string().trim().min(1).max(200),
  company: z.string().trim().max(300).optional(),
  position: z.string().trim().max(200).optional(),
  email: z.string().trim().email().max(255).optional(),
  phone: z.string().trim().max(100).optional(),
  linkedinUrl: z.string().trim().url().max(1000).optional(),
  website: z.string().trim().url().max(1000).optional(),
  source: z.string().trim().max(300).optional(),
  opportunityId: z.string().trim().min(1).optional(),
  status: LEAD_STATUS_ENUM.optional(),
  estimatedValue: z.number().min(0).optional(),
  probability: z.number().int().min(0).max(100).optional(),
  lastContactAt: z.string().datetime().optional(),
  nextFollowUpAt: z.string().datetime().optional(),
  notes: z.string().trim().max(4000).optional(),
});

const updateLeadSchema = createLeadSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update',
  });

const createDraftSchema = z.object({
  kind: DRAFT_KIND_ENUM.optional(),
  channel: z.string().trim().max(50).optional(),
  leadId: z.string().trim().min(1).optional(),
  opportunityId: z.string().trim().min(1).optional(),
  recipientName: z.string().trim().max(200).optional(),
  recipientEmail: z.string().trim().email().max(255).optional(),
  subject: z.string().trim().max(500).optional(),
  content: z.string().trim().min(1).max(20000),
});

const updateDraftSchema = z
  .object({
    channel: z.string().trim().max(50).optional(),
    recipientName: z.string().trim().max(200).nullable().optional(),
    recipientEmail: z.string().trim().email().max(255).nullable().optional(),
    subject: z.string().trim().max(500).nullable().optional(),
    content: z.string().trim().min(1).max(20000).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update',
  });

const pitchSchema = z.object({
  kind: PITCH_KIND_ENUM,
  company: z.string().trim().min(1).max(300),
  recipientName: z.string().trim().max(200).optional(),
  recipientTitle: z.string().trim().max(200).optional(),
  opportunityDescription: z.string().trim().max(4000).optional(),
  serviceName: z.string().trim().max(200).optional(),
  suggestedPrice: z.string().trim().max(200).optional(),
  context: z.string().trim().max(4000).optional(),
  tone: z.string().trim().max(100).optional(),
  researchId: z.string().trim().min(1).optional(),
});

const researchSchema = z
  .object({
    companyName: z.string().trim().min(1).max(300).optional(),
    website: z.string().trim().url().max(1000).optional(),
  })
  .refine((value) => value.companyName || value.website, {
    message: 'Provide a companyName or website',
  });

const discoverSchema = z
  .object({
    query: z.string().trim().min(1).max(500).optional(),
    url: z.string().trim().url().max(1000).optional(),
    companyWebsite: z.string().trim().url().max(1000).optional(),
    sources: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
    limit: z.number().int().min(1).max(50).optional(),
    save: z.boolean().optional(),
  })
  .refine((value) => value.query || value.url || value.companyWebsite, {
    message: 'Provide a query, url, or companyWebsite to search for opportunities',
  });

const discoverSubmitSchema = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().trim().max(4000).optional(),
  company: z.string().trim().max(300).optional(),
  companyWebsite: z.string().trim().max(1000).optional(),
  sourceUrl: z.string().trim().url().max(1000).optional(),
  location: z.string().trim().max(300).optional(),
  remote: z.boolean().optional(),
  compensation: z.string().trim().max(300).optional(),
  employmentType: z.string().trim().max(100).optional(),
  requiredSkills: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
  technologies: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
  industry: z.string().trim().max(200).optional(),
  companySize: z.string().trim().max(100).optional(),
  clientName: z.string().trim().max(300).optional(),
  clientRole: z.string().trim().max(200).optional(),
  postedAt: z.string().datetime().optional(),
  deadline: z.string().datetime().optional(),
  estimatedBudget: z.number().min(0).optional(),
  recurringPotential: z.boolean().optional(),
  urgency: z.string().trim().max(300).optional(),
  rawContent: z.string().trim().max(12000).optional(),
});

const personaSchema = z.object({
  companyName: z.string().trim().min(1).max(300).optional(),
  researchId: z.string().trim().min(1).optional(),
  opportunityId: z.string().trim().min(1).optional(),
  context: z.string().trim().max(4000).optional(),
});

const offerDesignSchema = z
  .object({
    companyName: z.string().trim().max(300).optional(),
    researchId: z.string().trim().min(1).optional(),
    opportunityId: z.string().trim().min(1).optional(),
    opportunityDescription: z.string().trim().max(4000).optional(),
    context: z.string().trim().max(4000).optional(),
  })
  .refine((value) => value.companyName || value.opportunityId, {
    message: 'Provide a companyName or opportunityId',
  });

const createOfferSchema = z.object({
  opportunityId: z.string().trim().min(1).optional(),
  leadId: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1).max(300),
  description: z.string().trim().max(4000).optional(),
  components: z.array(z.string().trim().min(1).max(300)).max(50).optional(),
  suggestedPrice: z.number().min(0).optional(),
  minimumPrice: z.number().min(0).optional(),
  targetMargin: z.number().int().min(0).max(90).optional(),
  currency: z.string().trim().max(10).optional(),
  deliveryEstimate: z.string().trim().max(200).optional(),
  validDays: z.number().int().min(1).max(365).optional(),
  status: z.string().trim().max(50).optional(),
  notes: z.string().trim().max(4000).optional(),
});

const updateOfferSchema = z
  .object({
    opportunityId: z.string().trim().min(1).nullable().optional(),
    leadId: z.string().trim().min(1).nullable().optional(),
    name: z.string().trim().min(1).max(300).optional(),
    description: z.string().trim().max(4000).nullable().optional(),
    components: z.array(z.string().trim().min(1).max(300)).max(50).optional(),
    suggestedPrice: z.number().min(0).nullable().optional(),
    minimumPrice: z.number().min(0).nullable().optional(),
    targetMargin: z.number().int().min(0).max(90).optional(),
    currency: z.string().trim().max(10).optional(),
    deliveryEstimate: z.string().trim().max(200).nullable().optional(),
    validDays: z.number().int().min(1).max(365).optional(),
    status: z.string().trim().max(50).optional(),
    notes: z.string().trim().max(4000).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update',
  });

const objectionsSchema = z
  .object({
    companyName: z.string().trim().max(300).optional(),
    researchId: z.string().trim().min(1).optional(),
    opportunityId: z.string().trim().min(1).optional(),
    offer: z.string().trim().max(4000).optional(),
    price: z.string().trim().max(200).optional(),
    context: z.string().trim().max(4000).optional(),
  })
  .refine((value) => value.companyName || value.opportunityId, {
    message: 'Provide a companyName or opportunityId',
  });

const negotiationSchema = z
  .object({
    companyName: z.string().trim().max(300).optional(),
    researchId: z.string().trim().min(1).optional(),
    opportunityId: z.string().trim().min(1).optional(),
    offer: z.string().trim().max(4000).optional(),
    minimumPrice: z.number().min(0).optional(),
    targetPrice: z.number().min(0).optional(),
    currency: z.string().trim().max(10).optional(),
    context: z.string().trim().max(4000).optional(),
  })
  .refine((value) => value.companyName || value.opportunityId, {
    message: 'Provide a companyName or opportunityId',
  });

const marginSchema = z.object({
  minimumPrice: z.number().min(0).optional(),
  targetPrice: z.number().min(0).optional(),
  targetMargin: z.number().int().min(0).max(90).optional(),
  estimatedCost: z.number().min(0).optional(),
  currency: z.string().trim().max(10).optional(),
});

async function loadResearch(
  userId: string,
  researchId?: string,
): Promise<CompanyResearchResult | null> {
  if (!researchId || !prisma) {
    return null;
  }
  const record = await prisma.companyResearch.findFirst({
    where: { id: researchId, userId },
  });
  return (record?.findings as CompanyResearchResult | null) ?? null;
}

async function currentUserSkills(userId: string): Promise<string[]> {
  if (!prisma) {
    return [];
  }
  const memories = await prisma.memory.findMany({
    where: { userId },
    take: 100,
    select: { key: true, value: true },
  });
  const skills: string[] = [];
  for (const entry of memories) {
    if (
      ['skills', 'skill', 'stack', 'technologies', 'expertise', 'experience'].some((tag) =>
        entry.key.toLowerCase().includes(tag),
      )
    ) {
      skills.push(`${entry.key} ${entry.value}`);
    }
  }
  return skills;
}

async function buildOverview(userId: string): Promise<Record<string, unknown>> {
  if (!prisma) {
    throw new HttpError(503, 'Database not configured');
  }
  const [leadCount, won, lost, followUpsDue, opportunityCount, highPriority, leads] =
    await Promise.all([
      prisma.lead.count({ where: { userId } }),
      prisma.lead.count({ where: { userId, status: 'WON' } }),
      prisma.lead.count({ where: { userId, status: 'LOST' } }),
      prisma.lead.count({
        where: {
          userId,
          status: { notIn: ['WON', 'LOST'] },
          nextFollowUpAt: { lte: new Date() },
        },
      }),
      prisma.opportunity.count({ where: { userId } }),
      prisma.opportunity.count({ where: { userId, score: { gte: 70 } } }),
      prisma.lead.findMany({
        where: { userId },
        select: { estimatedValue: true, status: true },
      }),
    ]);

  const byStage: Record<LeadStatusValue, number> = {
    NEW: 0,
    QUALIFIED: 0,
    CONTACTED: 0,
    RESPONDED: 0,
    MEETING: 0,
    PROPOSAL: 0,
    NEGOTIATION: 0,
    WON: 0,
    LOST: 0,
  };
  let pipelineValue = 0;
  for (const lead of leads) {
    if (lead.status === 'WON' || lead.status === 'LOST') {
      continue;
    }
    byStage[lead.status] = (byStage[lead.status] ?? 0) + 1;
    pipelineValue += money(lead.estimatedValue) ?? 0;
  }

  const closed = won + lost;
  return {
    pipelineValue,
    leads: leadCount,
    opportunities: opportunityCount,
    highPriorityOpportunities: highPriority,
    followUpsDue,
    dealsWon: won,
    dealsLost: lost,
    conversionRate: closed > 0 ? Math.round((won / closed) * 100) : 0,
    byStage,
  };
}

export async function salesRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  app.get('/sales/overview', async (request) => {
    return buildOverview(requireUserId(request));
  });

  app.get('/sales/services', async (request) => {
    const userId = requireUserId(request);
    await seedDefaultServices(userId);
    const services = await listServices({ userId });
    return { services: services.map(serviceResponse) };
  });

  app.post('/sales/services', async (request, reply) => {
    const parsed = createServiceSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new HttpError(400, 'Invalid request body');
    }
    const userId = requireUserId(request);
    if (!prisma) {
      throw new HttpError(503, 'Database not configured');
    }
    const data = parsed.data;
    const service = await prisma.service.create({
      data: {
        userId,
        name: data.name,
        description: data.description ?? null,
        pricing: data.pricing ?? null,
        minimumPrice: data.minimumPrice,
        targetMargin: data.targetMargin ?? 30,
        requiredSkills: data.requiredSkills ?? [],
        deliveryEstimate: data.deliveryEstimate ?? null,
        upsells: data.upsells ?? [],
        recurringServices: data.recurringServices ?? [],
        active: data.active ?? true,
        sortOrder: data.sortOrder ?? 0,
      },
    });
    salesAudit(request, 'sales.service.create', service.id, { name: service.name });
    return reply.status(201).send({ service: serviceResponse(service) });
  });

  app.patch('/sales/services/:id', async (request) => {
    const parsed = updateServiceSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new HttpError(400, 'Invalid request body');
    }
    const { id } = request.params as { id: string };
    const userId = requireUserId(request);
    if (!prisma) {
      throw new HttpError(503, 'Database not configured');
    }
    const existing = await prisma.service.findFirst({ where: { id, userId } });
    if (!existing) {
      throw new HttpError(404, 'Service not found');
    }
    const data = parsed.data;
    const service = await prisma.service.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.pricing !== undefined ? { pricing: data.pricing } : {}),
        ...(data.minimumPrice !== undefined ? { minimumPrice: data.minimumPrice } : {}),
        ...(data.targetMargin !== undefined ? { targetMargin: data.targetMargin } : {}),
        ...(data.requiredSkills !== undefined ? { requiredSkills: data.requiredSkills } : {}),
        ...(data.deliveryEstimate !== undefined ? { deliveryEstimate: data.deliveryEstimate } : {}),
        ...(data.upsells !== undefined ? { upsells: data.upsells } : {}),
        ...(data.recurringServices !== undefined
          ? { recurringServices: data.recurringServices }
          : {}),
        ...(data.active !== undefined ? { active: data.active } : {}),
        ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
      },
    });
    salesAudit(request, 'sales.service.update', service.id, { name: service.name });
    return { service: serviceResponse(service) };
  });

  app.delete('/sales/services/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = requireUserId(request);
    if (!prisma) {
      throw new HttpError(503, 'Database not configured');
    }
    const existing = await prisma.service.findFirst({ where: { id, userId } });
    if (!existing) {
      throw new HttpError(404, 'Service not found');
    }
    const deleted = await prisma.service.deleteMany({ where: { id, userId } });
    if (deleted.count === 0) {
      throw new HttpError(404, 'Service not found');
    }
    salesAudit(request, 'sales.service.delete', id, { name: existing.name });
    return reply.status(204).send();
  });

  app.get('/sales/services/:id/estimate', async (request) => {
    const { id } = request.params as { id: string };
    const userId = requireUserId(request);
    const services = await listServices({ userId });
    const service = services.find((item) => item.id === id);
    if (!service) {
      throw new HttpError(404, 'Service not found');
    }
    return { estimate: estimatePrice(service) };
  });

  app.get('/sales/opportunities', async (request) => {
    const userId = requireUserId(request);
    if (!prisma) {
      throw new HttpError(503, 'Database not configured');
    }
    const { status, minScore } = request.query as { status?: string; minScore?: string };
    const opportunities = await prisma.opportunity.findMany({
      where: {
        userId,
        ...(status ? { status: status as never } : {}),
        ...(minScore ? { score: { gte: Number(minScore) } } : {}),
      },
      orderBy: [{ score: 'desc' }, { createdAt: 'desc' }],
    });
    return { opportunities: opportunities.map(opportunityResponse) };
  });

  app.post('/sales/opportunities', async (request, reply) => {
    const parsed = createOpportunitySchema.safeParse(request.body);
    if (!parsed.success) {
      throw new HttpError(400, 'Invalid request body');
    }
    const userId = requireUserId(request);
    if (!prisma) {
      throw new HttpError(503, 'Database not configured');
    }
    const data = parsed.data;
    const userSkills = await currentUserSkills(userId);
    const score = scoreOpportunity({
      type: data.type,
      status: data.status,
      estimatedBudget: data.estimatedBudget,
      industry: data.industry ?? null,
      urgency: data.urgency ?? null,
      source: data.source ?? null,
      requiredSkills: data.requiredSkills,
      userSkills,
    });
    const opportunity = await prisma.opportunity.create({
      data: {
        userId,
        title: data.title,
        description: data.description ?? null,
        company: data.company ?? null,
        companyWebsite: data.companyWebsite ?? null,
        source: data.source ?? null,
        sourceUrl: data.sourceUrl ?? null,
        location: data.location ?? null,
        remote: data.remote ?? false,
        compensation: data.compensation ?? null,
        currency: data.currency ?? 'USD',
        employmentType: data.employmentType ?? null,
        requiredSkills: data.requiredSkills ?? [],
        technologies: data.technologies ?? [],
        estimatedBudget: data.estimatedBudget,
        industry: data.industry ?? null,
        companySize: data.companySize ?? null,
        clientName: data.clientName ?? null,
        clientRole: data.clientRole ?? null,
        postedAt: data.postedAt ? new Date(data.postedAt) : null,
        deadline: data.deadline ? new Date(data.deadline) : null,
        recurringPotential: data.recurringPotential ?? false,
        sourceReliability: data.sourceReliability ?? null,
        rawContent: data.rawContent ?? null,
        urgency: data.urgency ?? null,
        type: data.type ?? 'POTENTIAL_CLIENT',
        status: data.status ?? 'NEW',
        score: score.score,
        notes: data.notes ?? null,
      },
    });
    salesAudit(request, 'sales.opportunity.create', opportunity.id, {
      title: opportunity.title,
      source: opportunity.source,
    });
    return reply.status(201).send({
      opportunity: opportunityResponse(opportunity),
      score,
    });
  });

  app.get('/sales/opportunities/:id', async (request) => {
    const { id } = request.params as { id: string };
    const userId = requireUserId(request);
    if (!prisma) {
      throw new HttpError(503, 'Database not configured');
    }
    const opportunity = await prisma.opportunity.findFirst({ where: { id, userId } });
    if (!opportunity) {
      throw new HttpError(404, 'Opportunity not found');
    }
    return { opportunity: opportunityResponse(opportunity) };
  });

  app.patch('/sales/opportunities/:id', async (request) => {
    const parsed = updateOpportunitySchema.safeParse(request.body);
    if (!parsed.success) {
      throw new HttpError(400, 'Invalid request body');
    }
    const { id } = request.params as { id: string };
    const userId = requireUserId(request);
    if (!prisma) {
      throw new HttpError(503, 'Database not configured');
    }
    const existing = await prisma.opportunity.findFirst({ where: { id, userId } });
    if (!existing) {
      throw new HttpError(404, 'Opportunity not found');
    }
    const data = parsed.data;
    const opportunity = await prisma.opportunity.update({
      where: { id },
      data: {
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.company !== undefined ? { company: data.company } : {}),
        ...(data.companyWebsite !== undefined ? { companyWebsite: data.companyWebsite } : {}),
        ...(data.source !== undefined ? { source: data.source } : {}),
        ...(data.sourceUrl !== undefined ? { sourceUrl: data.sourceUrl } : {}),
        ...(data.location !== undefined ? { location: data.location } : {}),
        ...(data.remote !== undefined ? { remote: data.remote } : {}),
        ...(data.compensation !== undefined ? { compensation: data.compensation } : {}),
        ...(data.currency !== undefined ? { currency: data.currency } : {}),
        ...(data.employmentType !== undefined ? { employmentType: data.employmentType } : {}),
        ...(data.requiredSkills !== undefined ? { requiredSkills: data.requiredSkills } : {}),
        ...(data.technologies !== undefined ? { technologies: data.technologies } : {}),
        ...(data.estimatedBudget !== undefined ? { estimatedBudget: data.estimatedBudget } : {}),
        ...(data.industry !== undefined ? { industry: data.industry } : {}),
        ...(data.companySize !== undefined ? { companySize: data.companySize } : {}),
        ...(data.clientName !== undefined ? { clientName: data.clientName } : {}),
        ...(data.clientRole !== undefined ? { clientRole: data.clientRole } : {}),
        ...(data.postedAt !== undefined ? { postedAt: new Date(data.postedAt) } : {}),
        ...(data.deadline !== undefined ? { deadline: new Date(data.deadline) } : {}),
        ...(data.recurringPotential !== undefined
          ? { recurringPotential: data.recurringPotential }
          : {}),
        ...(data.sourceReliability !== undefined
          ? { sourceReliability: data.sourceReliability }
          : {}),
        ...(data.rawContent !== undefined ? { rawContent: data.rawContent } : {}),
        ...(data.urgency !== undefined ? { urgency: data.urgency } : {}),
        ...(data.type !== undefined ? { type: data.type } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.notes !== undefined ? { notes: data.notes } : {}),
      },
    });
    salesAudit(request, 'sales.opportunity.update', opportunity.id, {
      title: opportunity.title,
    });
    return { opportunity: opportunityResponse(opportunity) };
  });

  app.delete('/sales/opportunities/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = requireUserId(request);
    if (!prisma) {
      throw new HttpError(503, 'Database not configured');
    }
    const existing = await prisma.opportunity.findFirst({ where: { id, userId } });
    if (!existing) {
      throw new HttpError(404, 'Opportunity not found');
    }
    const deleted = await prisma.opportunity.deleteMany({ where: { id, userId } });
    if (deleted.count === 0) {
      throw new HttpError(404, 'Opportunity not found');
    }
    salesAudit(request, 'sales.opportunity.delete', id, { title: existing.title });
    return reply.status(204).send();
  });

  app.post('/sales/opportunities/:id/score', async (request) => {
    const { id } = request.params as { id: string };
    const userId = requireUserId(request);
    if (!prisma) {
      throw new HttpError(503, 'Database not configured');
    }
    const existing = await prisma.opportunity.findFirst({ where: { id, userId } });
    if (!existing) {
      throw new HttpError(404, 'Opportunity not found');
    }
    const userSkills = await currentUserSkills(userId);
    const score = scoreOpportunity({
      type: existing.type as never,
      status: existing.status as never,
      estimatedBudget: money(existing.estimatedBudget),
      industry: existing.industry,
      urgency: existing.urgency ?? null,
      source: existing.source ?? null,
      requiredSkills: existing.requiredSkills,
      userSkills,
    });
    const opportunity = await prisma.opportunity.update({
      where: { id },
      data: { score: score.score },
    });
    salesAudit(request, 'sales.opportunity.score', id, { score: score.score });
    return { opportunity: opportunityResponse(opportunity), score };
  });

  app.get('/sales/discover/sources', async () => {
    return {
      sources: listSourceAdapters().map((adapter) => ({
        id: adapter.id,
        label: adapter.label,
        supportsSearch: adapter.supportsSearch,
        supportsFetchUrl: adapter.supportsFetchUrl,
        supportsCompanyWebsite: adapter.supportsCompanyWebsite,
      })),
    };
  });

  app.post('/sales/discover', async (request) => {
    const parsed = discoverSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new HttpError(400, 'Invalid request body');
    }
    const userId = requireUserId(request);
    if (!prisma) {
      throw new HttpError(503, 'Database not configured');
    }
    const { query, url, companyWebsite, sources, limit, save } = parsed.data;
    const result = await discoverOpportunities({ query, url, companyWebsite, sources, limit });

    const classified = result.candidates.map((candidate) => {
      const { type, reason } = classifyCandidate(candidate);
      return { ...candidate, type, typeReason: reason };
    });

    let saved: unknown[] = [];
    if (save) {
      const userSkills = await currentUserSkills(userId);
      for (const candidate of result.candidates) {
        try {
          const { type } = classifyCandidate(candidate);
          const score = scoreOpportunity({
            type: type as never,
            estimatedBudget: candidate.estimatedBudget,
            industry: candidate.industry ?? null,
            urgency: candidate.urgency ?? null,
            source: candidate.source,
            requiredSkills: candidate.requiredSkills ?? [],
            userSkills,
          });
          saved.push(
            await prisma.opportunity.create({
              data: {
                userId,
                title: candidate.title,
                description: candidate.description ?? null,
                company: candidate.company ?? null,
                companyWebsite: candidate.companyWebsite ?? null,
                source: candidate.source,
                sourceUrl: candidate.sourceUrl ?? null,
                location: candidate.location ?? null,
                remote: candidate.remote ?? false,
                compensation: candidate.compensation ?? null,
                currency: candidate.currency ?? 'USD',
                employmentType: candidate.employmentType ?? null,
                requiredSkills: candidate.requiredSkills ?? [],
                technologies: candidate.technologies ?? [],
                estimatedBudget: candidate.estimatedBudget,
                industry: candidate.industry ?? null,
                companySize: candidate.companySize ?? null,
                clientName: candidate.clientName ?? null,
                clientRole: candidate.clientRole ?? null,
                postedAt: candidate.postedAt ? new Date(candidate.postedAt) : null,
                deadline: candidate.deadline ? new Date(candidate.deadline) : null,
                recurringPotential: candidate.recurringPotential ?? false,
                sourceReliability: candidate.sourceReliability ?? null,
                rawContent: candidate.rawContent ?? null,
                urgency: candidate.urgency ?? null,
                type: type as never,
                score: score.score,
              },
            }),
          );
        } catch {
          // Skip candidates that fail to save (e.g. duplicates) without aborting.
        }
      }
      if (saved.length > 0) {
        salesAudit(request, 'sales.opportunity.save', undefined, {
          count: saved.length,
          query: query ?? null,
          url: url ?? null,
          companyWebsite: companyWebsite ?? null,
          sources,
        });
      }
    }

    return { candidates: classified, savedCount: saved.length, errors: result.errors };
  });

  app.post('/sales/discover/submit', async (request, reply) => {
    const parsed = discoverSubmitSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new HttpError(400, 'Invalid request body');
    }
    const userId = requireUserId(request);
    if (!prisma) {
      throw new HttpError(503, 'Database not configured');
    }
    const data = parsed.data;
    const candidate: OpportunityCandidate = normalizeUserSubmitted({
      title: data.title,
      description: data.description,
      company: data.company,
      companyWebsite: data.companyWebsite,
      sourceUrl: data.sourceUrl,
      location: data.location,
      remote: data.remote,
      compensation: data.compensation,
      employmentType: data.employmentType,
      requiredSkills: data.requiredSkills,
      technologies: data.technologies,
      industry: data.industry,
      companySize: data.companySize,
      clientName: data.clientName,
      clientRole: data.clientRole,
      postedAt: data.postedAt,
      deadline: data.deadline,
      estimatedBudget: data.estimatedBudget,
      recurringPotential: data.recurringPotential,
      urgency: data.urgency,
      rawContent: data.rawContent,
    });

    const type = classifyCandidate(candidate).type;
    const userSkills = await currentUserSkills(userId);
    const score = scoreOpportunity({
      type: type as never,
      estimatedBudget: candidate.estimatedBudget,
      industry: candidate.industry ?? null,
      urgency: candidate.urgency ?? null,
      source: candidate.source,
      requiredSkills: candidate.requiredSkills ?? [],
      userSkills,
    });

    const opportunity = await prisma.opportunity.create({
      data: {
        userId,
        title: candidate.title,
        description: candidate.description ?? null,
        company: candidate.company ?? null,
        companyWebsite: candidate.companyWebsite ?? null,
        source: candidate.source,
        sourceUrl: candidate.sourceUrl ?? null,
        location: candidate.location ?? null,
        remote: candidate.remote ?? false,
        compensation: candidate.compensation ?? null,
        currency: candidate.currency ?? 'USD',
        employmentType: candidate.employmentType ?? null,
        requiredSkills: candidate.requiredSkills ?? [],
        technologies: candidate.technologies ?? [],
        estimatedBudget: candidate.estimatedBudget,
        industry: candidate.industry ?? null,
        companySize: candidate.companySize ?? null,
        clientName: candidate.clientName ?? null,
        clientRole: candidate.clientRole ?? null,
        postedAt: candidate.postedAt ? new Date(candidate.postedAt) : null,
        deadline: candidate.deadline ? new Date(candidate.deadline) : null,
        recurringPotential: candidate.recurringPotential ?? false,
        sourceReliability: candidate.sourceReliability ?? null,
        rawContent: candidate.rawContent ?? null,
        urgency: candidate.urgency ?? null,
        type: type as never,
        score: score.score,
      },
    });
    salesAudit(request, 'sales.opportunity.create', opportunity.id, {
      title: opportunity.title,
      source: opportunity.source,
    });
    return reply.status(201).send({
      opportunity: opportunityResponse(opportunity),
      score,
      type,
      typeReason: classifyCandidate(candidate).reason,
    });
  });

  app.get('/sales/leads', async (request) => {
    const userId = requireUserId(request);
    if (!prisma) {
      throw new HttpError(503, 'Database not configured');
    }
    const { status } = request.query as { status?: string };
    if (status && !LEAD_STATUSES.includes(status as never)) {
      throw new HttpError(
        400,
        `Invalid status filter. Must be one of: ${LEAD_STATUSES.join(', ')}`,
      );
    }
    const leads = await prisma.lead.findMany({
      where: {
        userId,
        ...(status ? { status: status as never } : {}),
      },
      orderBy: [{ createdAt: 'desc' }],
    });
    return { leads: leads.map(leadResponse) };
  });

  app.post('/sales/leads', async (request, reply) => {
    const parsed = createLeadSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new HttpError(400, 'Invalid request body');
    }
    const userId = requireUserId(request);
    if (!prisma) {
      throw new HttpError(503, 'Database not configured');
    }
    const data = parsed.data;
    if (data.opportunityId) {
      const opportunity = await prisma.opportunity.findFirst({
        where: { id: data.opportunityId, userId },
        select: { id: true },
      });
      if (!opportunity) {
        throw new HttpError(400, 'Linked opportunity does not exist');
      }
    }
    const lead = await prisma.lead.create({
      data: {
        userId,
        name: data.name,
        company: data.company ?? null,
        position: data.position ?? null,
        email: data.email ?? null,
        phone: data.phone ?? null,
        linkedinUrl: data.linkedinUrl ?? null,
        website: data.website ?? null,
        source: data.source ?? null,
        opportunityId: data.opportunityId ?? null,
        status: data.status ?? 'NEW',
        estimatedValue: data.estimatedValue,
        probability: data.probability ?? 0,
        lastContactAt: data.lastContactAt ? new Date(data.lastContactAt) : null,
        nextFollowUpAt: data.nextFollowUpAt ? new Date(data.nextFollowUpAt) : null,
        notes: data.notes ?? null,
      },
    });
    salesAudit(request, 'sales.lead.create', lead.id, { name: lead.name });
    return reply.status(201).send({ lead: leadResponse(lead) });
  });

  app.get('/sales/leads/:id', async (request) => {
    const { id } = request.params as { id: string };
    const userId = requireUserId(request);
    if (!prisma) {
      throw new HttpError(503, 'Database not configured');
    }
    const lead = await prisma.lead.findFirst({ where: { id, userId } });
    if (!lead) {
      throw new HttpError(404, 'Lead not found');
    }
    return { lead: leadResponse(lead) };
  });

  app.patch('/sales/leads/:id', async (request) => {
    const parsed = updateLeadSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new HttpError(400, 'Invalid request body');
    }
    const { id } = request.params as { id: string };
    const userId = requireUserId(request);
    if (!prisma) {
      throw new HttpError(503, 'Database not configured');
    }
    const existing = await prisma.lead.findFirst({ where: { id, userId } });
    if (!existing) {
      throw new HttpError(404, 'Lead not found');
    }
    const data = parsed.data;
    if (data.status !== undefined && data.status !== existing.status) {
      if (
        !canTransitionLeadStatus(existing.status as LeadStatusValue, data.status as LeadStatusValue)
      ) {
        throw new HttpError(409, `Cannot move a lead from ${existing.status} to ${data.status}`);
      }
    }
    if (data.opportunityId) {
      const opportunity = await prisma.opportunity.findFirst({
        where: { id: data.opportunityId, userId },
        select: { id: true },
      });
      if (!opportunity) {
        throw new HttpError(400, 'Linked opportunity does not exist');
      }
    }
    const lead = await prisma.lead.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.company !== undefined ? { company: data.company } : {}),
        ...(data.position !== undefined ? { position: data.position } : {}),
        ...(data.email !== undefined ? { email: data.email } : {}),
        ...(data.phone !== undefined ? { phone: data.phone } : {}),
        ...(data.linkedinUrl !== undefined ? { linkedinUrl: data.linkedinUrl } : {}),
        ...(data.website !== undefined ? { website: data.website } : {}),
        ...(data.source !== undefined ? { source: data.source } : {}),
        ...(data.opportunityId !== undefined ? { opportunityId: data.opportunityId } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.estimatedValue !== undefined ? { estimatedValue: data.estimatedValue } : {}),
        ...(data.probability !== undefined ? { probability: data.probability } : {}),
        ...(data.lastContactAt !== undefined
          ? { lastContactAt: data.lastContactAt ? new Date(data.lastContactAt) : null }
          : {}),
        ...(data.nextFollowUpAt !== undefined
          ? { nextFollowUpAt: data.nextFollowUpAt ? new Date(data.nextFollowUpAt) : null }
          : {}),
        ...(data.notes !== undefined ? { notes: data.notes } : {}),
      },
    });
    salesAudit(request, 'sales.lead.update', lead.id, { name: lead.name });
    return { lead: leadResponse(lead) };
  });

  app.delete('/sales/leads/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = requireUserId(request);
    if (!prisma) {
      throw new HttpError(503, 'Database not configured');
    }
    const existing = await prisma.lead.findFirst({ where: { id, userId } });
    if (!existing) {
      throw new HttpError(404, 'Lead not found');
    }
    const deleted = await prisma.lead.deleteMany({ where: { id, userId } });
    if (deleted.count === 0) {
      throw new HttpError(404, 'Lead not found');
    }
    salesAudit(request, 'sales.lead.delete', id, { name: existing.name });
    return reply.status(204).send();
  });

  app.post('/sales/leads/:id/next-action', async (request) => {
    const { id } = request.params as { id: string };
    const userId = requireUserId(request);
    if (!prisma) {
      throw new HttpError(503, 'Database not configured');
    }
    const lead = await prisma.lead.findFirst({ where: { id, userId } });
    if (!lead) {
      throw new HttpError(404, 'Lead not found');
    }
    const leadLike: LeadLike = {
      ...lead,
      estimatedValue: money(lead.estimatedValue),
    };
    const action = await nextBestAction({ lead: leadLike });
    return { action };
  });

  app.get('/sales/research', async (request) => {
    const userId = requireUserId(request);
    if (!prisma) {
      throw new HttpError(503, 'Database not configured');
    }
    const records = await prisma.companyResearch.findMany({
      where: { userId },
      orderBy: [{ refreshedAt: 'desc' }],
    });
    return { records: records.map((record) => ({ ...record, findings: undefined })) };
  });

  app.post('/sales/research', async (request, reply) => {
    const parsed = researchSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new HttpError(400, 'Invalid request body');
    }
    const userId = requireUserId(request);
    if (!prisma) {
      throw new HttpError(503, 'Database not configured');
    }
    const { companyName, website } = parsed.data;
    const findings = await researchCompany({ companyName, website });
    const record = await prisma.companyResearch.create({
      data: {
        userId,
        companyName: findings.companyName ?? companyName ?? null,
        website: findings.website ?? website ?? null,
        industry: findings.industry?.confidence === 'KNOWN' ? findings.industry.value : null,
        findings: findings as never,
        source: website ? 'website+search' : 'search',
      },
    });
    salesAudit(request, 'sales.research.create', record.id, {
      companyName: record.companyName,
      website: record.website,
    });
    return reply.status(201).send({ record: { ...record, findings } });
  });

  app.get('/sales/research/:id', async (request) => {
    const { id } = request.params as { id: string };
    const userId = requireUserId(request);
    if (!prisma) {
      throw new HttpError(503, 'Database not configured');
    }
    const record = await prisma.companyResearch.findFirst({ where: { id, userId } });
    if (!record) {
      throw new HttpError(404, 'Research not found');
    }
    return { record };
  });

  app.delete('/sales/research/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = requireUserId(request);
    if (!prisma) {
      throw new HttpError(503, 'Database not configured');
    }
    const existing = await prisma.companyResearch.findFirst({ where: { id, userId } });
    if (!existing) {
      throw new HttpError(404, 'Research not found');
    }
    const deleted = await prisma.companyResearch.deleteMany({ where: { id, userId } });
    if (deleted.count === 0) {
      throw new HttpError(404, 'Research not found');
    }
    salesAudit(request, 'sales.research.delete', id, { companyName: existing.companyName });
    return reply.status(204).send();
  });

  app.post('/sales/research/:id/analyze', async (request) => {
    const { id } = request.params as { id: string };
    const userId = requireUserId(request);
    if (!isAiConfigured()) {
      throw new HttpError(
        503,
        'No AI provider is configured. Add an API key to use prospect analysis.',
      );
    }
    const research = await loadResearch(userId, id);
    if (!research) {
      throw new HttpError(404, 'Research not found');
    }
    const services = (await listServices({ userId, activeOnly: true })).map(
      (service) => service.name,
    );
    const analysis = await analyzeProspect({
      companyName: research.companyName,
      website: research.website,
      research,
      services,
    });
    return { analysis };
  });

  app.get('/sales/drafts', async (request) => {
    const userId = requireUserId(request);
    if (!prisma) {
      throw new HttpError(503, 'Database not configured');
    }
    const { status } = request.query as { status?: string };
    if (status && !DRAFT_STATUSES.includes(status as never)) {
      throw new HttpError(
        400,
        `Invalid status filter. Must be one of: ${DRAFT_STATUSES.join(', ')}`,
      );
    }
    const drafts = await prisma.salesDraft.findMany({
      where: {
        userId,
        ...(status ? { status: status as never } : {}),
      },
      orderBy: [{ createdAt: 'desc' }],
    });
    return { drafts: drafts.map(draftResponse) };
  });

  app.post('/sales/drafts', async (request, reply) => {
    const parsed = createDraftSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new HttpError(400, 'Invalid request body');
    }
    const userId = requireUserId(request);
    if (!prisma) {
      throw new HttpError(503, 'Database not configured');
    }
    const data = parsed.data;
    if (data.leadId) {
      const lead = await prisma.lead.findFirst({
        where: { id: data.leadId, userId },
        select: { id: true },
      });
      if (!lead) {
        throw new HttpError(400, 'Linked lead does not exist');
      }
    }
    if (data.opportunityId) {
      const opportunity = await prisma.opportunity.findFirst({
        where: { id: data.opportunityId, userId },
        select: { id: true },
      });
      if (!opportunity) {
        throw new HttpError(400, 'Linked opportunity does not exist');
      }
    }
    const draft = await prisma.salesDraft.create({
      data: {
        userId,
        kind: data.kind ?? 'COLD_EMAIL',
        channel: data.channel ?? 'email',
        leadId: data.leadId ?? null,
        opportunityId: data.opportunityId ?? null,
        recipientName: data.recipientName ?? null,
        recipientEmail: data.recipientEmail ?? null,
        subject: data.subject ?? null,
        content: data.content,
      },
    });
    salesAudit(request, 'sales.draft.create', draft.id, {
      kind: draft.kind,
      channel: draft.channel,
    });
    return reply.status(201).send({ draft: draftResponse(draft) });
  });

  app.get('/sales/drafts/:id', async (request) => {
    const { id } = request.params as { id: string };
    const userId = requireUserId(request);
    if (!prisma) {
      throw new HttpError(503, 'Database not configured');
    }
    const draft = await prisma.salesDraft.findFirst({ where: { id, userId } });
    if (!draft) {
      throw new HttpError(404, 'Draft not found');
    }
    return { draft: draftResponse(draft) };
  });

  app.patch('/sales/drafts/:id', async (request) => {
    const parsed = updateDraftSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new HttpError(400, 'Invalid request body');
    }
    const { id } = request.params as { id: string };
    const userId = requireUserId(request);
    if (!prisma) {
      throw new HttpError(503, 'Database not configured');
    }
    const existing = await prisma.salesDraft.findFirst({ where: { id, userId } });
    if (!existing) {
      throw new HttpError(404, 'Draft not found');
    }
    try {
      assertCanEdit(existing as never, userId);
    } catch (error) {
      rethrowOutreachError(error);
    }
    const data = parsed.data;
    const draft = await prisma.salesDraft.update({
      where: { id },
      data: {
        ...(data.channel !== undefined ? { channel: data.channel } : {}),
        ...(data.recipientName !== undefined ? { recipientName: data.recipientName } : {}),
        ...(data.recipientEmail !== undefined ? { recipientEmail: data.recipientEmail } : {}),
        ...(data.subject !== undefined ? { subject: data.subject } : {}),
        ...(data.content !== undefined ? { content: data.content } : {}),
      },
    });
    salesAudit(request, 'sales.draft.update', draft.id, { kind: draft.kind });
    return { draft: draftResponse(draft) };
  });

  app.post('/sales/drafts/:id/approve', async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = requireUserId(request);
    if (!prisma) {
      throw new HttpError(503, 'Database not configured');
    }
    const existing = await prisma.salesDraft.findFirst({ where: { id, userId } });
    if (!existing) {
      throw new HttpError(404, 'Draft not found');
    }
    try {
      assertCanApprove(existing as never, userId);
    } catch (error) {
      rethrowOutreachError(error);
    }
    const draft = await prisma.salesDraft.update({
      where: { id },
      data: { status: 'APPROVED', approvedAt: new Date() },
    });
    salesAudit(request, 'sales.draft.approve', draft.id, { kind: draft.kind });
    return reply.send({ draft: draftResponse(draft) });
  });

  app.post('/sales/drafts/:id/send', async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = requireUserId(request);
    if (!prisma) {
      throw new HttpError(503, 'Database not configured');
    }
    const existing = await prisma.salesDraft.findFirst({ where: { id, userId } });
    if (!existing) {
      throw new HttpError(404, 'Draft not found');
    }
    if (existing.status !== 'APPROVED') {
      throw new HttpError(400, 'Draft must be approved before sending.');
    }
    if (!existing.recipientEmail) {
      throw new HttpError(400, 'No recipient email is set on this draft.');
    }
    try {
      const messageId = await sendEmailDraft(existing as never, userId);
      const draft = await prisma.salesDraft.update({
        where: { id },
        data: { status: 'SENT', sentAt: new Date(), error: null },
      });
      salesAudit(request, 'sales.draft.send', id, { messageId, kind: draft.kind });
      return reply.send({ draft: draftResponse(draft), messageId });
    } catch (error) {
      if (error instanceof OutreachError) {
        if (
          error.code === 'NOT_APPROVED' ||
          error.code === 'NEEDS_EMAIL' ||
          error.code === 'NOT_FOUND'
        ) {
          throw new HttpError(400, error.message);
        }
        await prisma.salesDraft.update({
          where: { id },
          data: {
            status: 'REJECTED',
            error: error.message.slice(0, 2000),
          },
        });
        salesAudit(request, 'sales.draft.send_failed', id, { error: error.message });
        throw new HttpError(400, error.message);
      }
      await prisma.salesDraft.update({
        where: { id },
        data: {
          status: 'REJECTED',
          error: error instanceof Error ? error.message.slice(0, 2000) : 'Send failed',
        },
      });
      salesAudit(request, 'sales.draft.send_failed', id, {
        error: error instanceof Error ? error.message : 'Send failed',
      });
      request.log.warn({ err: error }, 'Draft send failed');
      throw new HttpError(502, 'Failed to send the email. Check the Gmail connection.');
    }
  });

  app.delete('/sales/drafts/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = requireUserId(request);
    if (!prisma) {
      throw new HttpError(503, 'Database not configured');
    }
    const existing = await prisma.salesDraft.findFirst({ where: { id, userId } });
    if (!existing) {
      throw new HttpError(404, 'Draft not found');
    }
    const deleted = await prisma.salesDraft.deleteMany({ where: { id, userId } });
    if (deleted.count === 0) {
      throw new HttpError(404, 'Draft not found');
    }
    salesAudit(request, 'sales.draft.delete', id, { kind: existing.kind });
    return reply.status(204).send();
  });

  app.post('/sales/pitch', async (request, reply) => {
    const parsed = pitchSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new HttpError(400, 'Invalid request body');
    }
    const userId = requireUserId(request);
    if (!isAiConfigured()) {
      throw new HttpError(503, 'No AI provider is configured. Add an API key to generate a pitch.');
    }
    const data = parsed.data;
    const research = await loadResearch(userId, data.researchId);
    const pitch = await generatePitch({
      kind: data.kind,
      company: data.company,
      recipientName: data.recipientName,
      recipientTitle: data.recipientTitle,
      opportunityDescription: data.opportunityDescription,
      research,
      serviceName: data.serviceName,
      suggestedPrice: data.suggestedPrice,
      context: data.context,
      tone: data.tone,
    });
    return reply.status(200).send({ pitch });
  });

  app.get('/sales/offers', async (request) => {
    const userId = requireUserId(request);
    if (!prisma) {
      throw new HttpError(503, 'Database not configured');
    }
    const offers = await prisma.offer.findMany({
      where: { userId },
      orderBy: [{ updatedAt: 'desc' as const }],
    });
    return {
      offers: offers.map((offer) => ({
        ...offer,
        suggestedPrice: money(offer.suggestedPrice),
        minimumPrice: money(offer.minimumPrice),
        components: Array.isArray(offer.components) ? offer.components : [],
      })),
    };
  });

  app.post('/sales/offers', async (request, reply) => {
    const parsed = createOfferSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new HttpError(400, 'Invalid request body');
    }
    const userId = requireUserId(request);
    if (!prisma) {
      throw new HttpError(503, 'Database not configured');
    }
    const data = parsed.data;
    const offer = await prisma.offer.create({
      data: {
        userId,
        opportunityId: data.opportunityId ?? null,
        leadId: data.leadId ?? null,
        name: data.name,
        description: data.description ?? null,
        components: data.components ?? [],
        suggestedPrice: data.suggestedPrice ?? null,
        minimumPrice: data.minimumPrice ?? null,
        targetMargin: data.targetMargin ?? 30,
        currency: data.currency ?? 'USD',
        deliveryEstimate: data.deliveryEstimate ?? null,
        validDays: data.validDays ?? 30,
        status: (data.status ?? 'DRAFT') as never,
        notes: data.notes ?? null,
      },
    });
    salesAudit(request, 'sales.offer.create', offer.id, { name: offer.name });
    return reply.status(201).send({ offer });
  });

  app.get('/sales/offers/:id', async (request) => {
    const { id } = request.params as { id: string };
    const userId = requireUserId(request);
    if (!prisma) {
      throw new HttpError(503, 'Database not configured');
    }
    const offer = await prisma.offer.findFirst({ where: { id, userId } });
    if (!offer) {
      throw new HttpError(404, 'Offer not found');
    }
    return { offer };
  });

  app.patch('/sales/offers/:id', async (request) => {
    const parsed = updateOfferSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new HttpError(400, 'Invalid request body');
    }
    const { id } = request.params as { id: string };
    const userId = requireUserId(request);
    if (!prisma) {
      throw new HttpError(503, 'Database not configured');
    }
    const existing = await prisma.offer.findFirst({ where: { id, userId } });
    if (!existing) {
      throw new HttpError(404, 'Offer not found');
    }
    const data = parsed.data;
    const offer = await prisma.offer.update({
      where: { id },
      data: {
        ...(data.opportunityId !== undefined ? { opportunityId: data.opportunityId } : {}),
        ...(data.leadId !== undefined ? { leadId: data.leadId } : {}),
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.components !== undefined ? { components: data.components } : {}),
        ...(data.suggestedPrice !== undefined ? { suggestedPrice: data.suggestedPrice } : {}),
        ...(data.minimumPrice !== undefined ? { minimumPrice: data.minimumPrice } : {}),
        ...(data.targetMargin !== undefined ? { targetMargin: data.targetMargin } : {}),
        ...(data.currency !== undefined ? { currency: data.currency } : {}),
        ...(data.deliveryEstimate !== undefined ? { deliveryEstimate: data.deliveryEstimate } : {}),
        ...(data.validDays !== undefined ? { validDays: data.validDays } : {}),
        ...(data.status !== undefined ? { status: data.status as never } : {}),
        ...(data.notes !== undefined ? { notes: data.notes } : {}),
      },
    });
    salesAudit(request, 'sales.offer.update', offer.id, { name: offer.name });
    return { offer };
  });

  app.delete('/sales/offers/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = requireUserId(request);
    if (!prisma) {
      throw new HttpError(503, 'Database not configured');
    }
    const existing = await prisma.offer.findFirst({ where: { id, userId } });
    if (!existing) {
      throw new HttpError(404, 'Offer not found');
    }
    const deleted = await prisma.offer.deleteMany({ where: { id, userId } });
    if (deleted.count === 0) {
      throw new HttpError(404, 'Offer not found');
    }
    salesAudit(request, 'sales.offer.delete', id, { name: existing.name });
    return reply.status(204).send();
  });

  app.post('/sales/persona', async (request) => {
    const parsed = personaSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new HttpError(400, 'Invalid request body');
    }
    const userId = requireUserId(request);
    if (!isAiConfigured()) {
      throw new HttpError(503, 'No AI provider is configured. Add an API key to build a persona.');
    }
    const data = parsed.data;
    let research = null;
    if (data.researchId) {
      research = await loadResearch(userId, data.researchId);
    }
    let opportunityTitle: string | undefined;
    if (data.opportunityId && prisma) {
      const opportunity = await prisma.opportunity.findFirst({
        where: { id: data.opportunityId, userId },
      });
      if (opportunity) {
        opportunityTitle = opportunity.title;
        if (!data.companyName && !opportunity.company && opportunity.companyWebsite) {
          research = research ?? (await researchCompany({ website: opportunity.companyWebsite }));
        }
      }
    }
    const persona = await buildPersona({
      companyName: data.companyName,
      research,
      opportunityTitle,
      context: data.context,
    });
    return { persona };
  });

  app.post('/sales/offers/design', async (request) => {
    const parsed = offerDesignSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new HttpError(400, 'Invalid request body');
    }
    const userId = requireUserId(request);
    if (!isAiConfigured()) {
      throw new HttpError(503, 'No AI provider is configured. Add an API key to design an offer.');
    }
    const data = parsed.data;
    let research = null;
    if (data.researchId) {
      research = await loadResearch(userId, data.researchId);
    }
    let opportunityDescription = data.opportunityDescription;
    if (data.opportunityId && prisma) {
      const opportunity = await prisma.opportunity.findFirst({
        where: { id: data.opportunityId, userId },
      });
      if (opportunity) {
        opportunityDescription =
          opportunityDescription ?? opportunity.description ?? opportunity.title;
        if (!data.companyName && opportunity.company) {
          data.companyName = opportunity.company;
        }
      }
    }
    const services = await loadCatalogForOffer(userId);
    const offer = await designOffer({
      companyName: data.companyName,
      research,
      opportunityDescription,
      services,
      context: data.context,
    });
    return { offer };
  });

  app.post('/sales/objections', async (request) => {
    const parsed = objectionsSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new HttpError(400, 'Invalid request body');
    }
    const userId = requireUserId(request);
    if (!isAiConfigured()) {
      throw new HttpError(
        503,
        'No AI provider is configured. Add an API key to prepare objections.',
      );
    }
    const data = parsed.data;
    let research = null;
    if (data.researchId) {
      research = await loadResearch(userId, data.researchId);
    }
    let opportunityDescription: string | undefined;
    if (data.opportunityId && prisma) {
      const opportunity = await prisma.opportunity.findFirst({
        where: { id: data.opportunityId, userId },
      });
      if (opportunity) {
        opportunityDescription = opportunity.description ?? opportunity.title;
      }
    }
    const playbook = await prepareObjections({
      companyName: data.companyName,
      research,
      opportunityDescription,
      offer: data.offer,
      price: data.price,
      context: data.context,
    });
    return { objections: playbook };
  });

  app.post('/sales/negotiation', async (request) => {
    const parsed = negotiationSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new HttpError(400, 'Invalid request body');
    }
    const userId = requireUserId(request);
    if (!isAiConfigured()) {
      throw new HttpError(
        503,
        'No AI provider is configured. Add an API key to build a negotiation strategy.',
      );
    }
    const data = parsed.data;
    let research = null;
    if (data.researchId) {
      research = await loadResearch(userId, data.researchId);
    }
    let opportunityDescription: string | undefined;
    if (data.opportunityId && prisma) {
      const opportunity = await prisma.opportunity.findFirst({
        where: { id: data.opportunityId, userId },
      });
      if (opportunity) {
        opportunityDescription = opportunity.description ?? opportunity.title;
      }
    }
    const strategy = await buildNegotiationStrategy({
      companyName: data.companyName,
      research,
      opportunityDescription,
      offer: data.offer,
      minimumPrice: data.minimumPrice,
      targetPrice: data.targetPrice,
      currency: data.currency,
      context: data.context,
    });
    return { strategy };
  });

  app.post('/sales/margin', async (request) => {
    const parsed = marginSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new HttpError(400, 'Invalid request body');
    }
    const analysis = analyzeMargin(parsed.data);
    return { analysis };
  });
}

import { prisma } from '../lib/prisma.js';
import type { Tool } from '../tools/types.js';
import { estimatePrice, listServices } from './catalog.js';
import { analyzeProspect } from './intelligence.js';
import { analyzeMargin } from './margin.js';
import { buildNegotiationStrategy } from './negotiation.js';
import { nextBestAction } from './next-best-action.js';
import { prepareObjections } from './objections.js';
import { designOffer, loadCatalogForOffer } from './offers.js';
import { buildPersona } from './persona.js';
import { generatePitch } from './pitch.js';
import { researchCompany } from './research.js';
import { scoreOpportunity } from './scoring.js';
import { classifyCandidate, discoverOpportunities, listSourceAdapters } from './sources/index.js';
import type { OpportunityScoreInput } from './types.js';

export const salesResearchCompanyTool: Tool = {
  name: 'sales_research_company',
  description:
    'Research a company from its name and/or website and return a structured profile with confidence markers (KNOWN/INFERRED/ESTIMATED/UNKNOWN): what they do, industry, products, target customers, recent signals, likely pain points, automation and website opportunities, likely decision makers, and a suggested service to pitch.',
  parameters: {
    type: 'object',
    properties: {
      companyName: {
        type: 'string',
        description: 'The name of the company to research.',
      },
      website: {
        type: 'string',
        description: 'Optional website URL of the company.',
      },
    },
  },
  async execute(args) {
    const companyName = typeof args.companyName === 'string' ? args.companyName.trim() : '';
    const website = typeof args.website === 'string' ? args.website.trim() : '';
    if (!companyName && !website) {
      throw new Error('Provide a companyName or a website to research.');
    }
    const result = await researchCompany({ companyName, website });
    return JSON.stringify(result, null, 2);
  },
};

export const salesAnalyzeProspectTool: Tool = {
  name: 'sales_analyze_prospect',
  description:
    'Analyze a potential client and return a consultative sales assessment: likely business problems, buying signals, why they might need a service, likely decision makers, the best service/offer and approach, likely objections, and the recommended next best action.',
  parameters: {
    type: 'object',
    properties: {
      companyName: {
        type: 'string',
        description: 'The name of the prospect company.',
      },
      website: {
        type: 'string',
        description: 'Optional website URL of the prospect.',
      },
      context: {
        type: 'string',
        description: 'Optional context: how you found them, what you know, what they asked for.',
      },
      researchId: {
        type: 'string',
        description: 'Optional id of a saved company research record to ground the analysis.',
      },
    },
  },
  async execute(args, context) {
    const companyName = typeof args.companyName === 'string' ? args.companyName.trim() : '';
    const website = typeof args.website === 'string' ? args.website.trim() : '';
    const researchId = typeof args.researchId === 'string' ? args.researchId.trim() : '';
    const rawContext = typeof args.context === 'string' ? args.context.trim() : '';

    let research = null;
    if (researchId && prisma) {
      const record = await prisma.companyResearch.findFirst({
        where: { id: researchId, userId: context.userId },
      });
      if (record) {
        research = record.findings as Record<string, unknown> | null;
      }
    }
    const services = (await listServices({ userId: context.userId, activeOnly: true })).map(
      (service) => service.name,
    );
    const result = await analyzeProspect({
      companyName,
      website,
      research,
      services,
      context: rawContext,
    });
    return JSON.stringify(result, null, 2);
  },
};

export const salesScoreOpportunityTool: Tool = {
  name: 'sales_score_opportunity',
  description:
    'Score a business opportunity from 0-100 using configurable weights (skill fit, budget, profit potential, client quality, urgency, recurring potential, win probability). Pass an opportunityId to score a saved opportunity, or pass fields to score a new one.',
  parameters: {
    type: 'object',
    properties: {
      opportunityId: {
        type: 'string',
        description: 'Id of a saved opportunity to score.',
      },
      title: {
        type: 'string',
        description: 'Opportunity title (when not scoring a saved opportunity).',
      },
      type: {
        type: 'string',
        description: 'JOB, POTENTIAL_CLIENT, OUTSOURCING, PARTNERSHIP, or RECURRING.',
      },
      estimatedBudget: {
        type: 'string',
        description: 'Estimated budget in USD.',
      },
      urgency: {
        type: 'string',
        description: 'Urgency note, e.g. "needs to start this month".',
      },
      requiredSkills: {
        type: 'string',
        description: 'Comma-separated skills the opportunity requires.',
      },
    },
  },
  async execute(args, context) {
    let input: {
      title?: string;
      type?: string;
      estimatedBudget?: number;
      urgency?: string;
      requiredSkills?: string[];
      source?: string;
      status?: string;
    } = {};

    const opportunityId = typeof args.opportunityId === 'string' ? args.opportunityId.trim() : '';
    if (opportunityId && prisma) {
      const opportunity = await prisma.opportunity.findFirst({
        where: { id: opportunityId, userId: context.userId },
      });
      if (!opportunity) {
        throw new Error('Opportunity not found');
      }
      input = {
        title: opportunity.title,
        type: opportunity.type,
        estimatedBudget: opportunity.estimatedBudget?.toNumber(),
        urgency: opportunity.urgency ?? undefined,
        requiredSkills: opportunity.requiredSkills,
        source: opportunity.source ?? undefined,
        status: opportunity.status,
      };
    } else {
      const requiredSkills =
        typeof args.requiredSkills === 'string'
          ? args.requiredSkills
              .split(',')
              .map((skill) => skill.trim())
              .filter(Boolean)
          : undefined;
      input = {
        title: typeof args.title === 'string' ? args.title : undefined,
        type: typeof args.type === 'string' ? args.type : undefined,
        estimatedBudget:
          typeof args.estimatedBudget === 'string' ? Number(args.estimatedBudget) : undefined,
        urgency: typeof args.urgency === 'string' ? args.urgency : undefined,
        requiredSkills,
      };
    }

    const userSkills: string[] = [];
    if (prisma) {
      const memory = await prisma.memory.findMany({
        where: { userId: context.userId },
        take: 100,
        select: { key: true, value: true },
      });
      for (const entry of memory) {
        const text = `${entry.key} ${entry.value}`.toLowerCase();
        if (
          ['skills', 'skill', 'stack', 'technologies', 'expertise', 'experience'].some((tag) =>
            entry.key.toLowerCase().includes(tag),
          )
        ) {
          userSkills.push(text);
        }
      }
    }

    const result = scoreOpportunity({ ...input, userSkills } as OpportunityScoreInput);
    return `Opportunity score: ${result.score}/100\n\nBreakdown:\n${JSON.stringify(result.breakdown, null, 2)}\n\nWeights:\n${JSON.stringify(result.weights, null, 2)}`;
  },
};

export const salesGeneratePitchTool: Tool = {
  name: 'sales_generate_pitch',
  description:
    'Generate a personalized, consultative outreach message (cold email, LinkedIn message, job application, follow-up, or proposal introduction) for a specific prospect. Focuses on their problem and outcome. Never invents facts.',
  parameters: {
    type: 'object',
    properties: {
      kind: {
        type: 'string',
        description: 'COLD_EMAIL, LINKEDIN, JOB_APPLICATION, FOLLOW_UP, or PROPOSAL.',
      },
      company: {
        type: 'string',
        description: 'The prospect company.',
      },
      recipientName: {
        type: 'string',
        description: 'Optional recipient name.',
      },
      opportunityDescription: {
        type: 'string',
        description: 'Optional description of the opportunity or the problem you are solving.',
      },
      serviceName: {
        type: 'string',
        description: 'Optional service to pitch.',
      },
      researchId: {
        type: 'string',
        description: 'Optional id of a saved company research record.',
      },
      context: {
        type: 'string',
        description: 'Optional extra context.',
      },
      tone: {
        type: 'string',
        description: 'Optional tone, e.g. "professional", "warm", "concise".',
      },
    },
    required: ['kind', 'company'],
  },
  async execute(args, context) {
    const kind = String(args.kind ?? '').toUpperCase();
    const allowed = ['COLD_EMAIL', 'LINKEDIN', 'JOB_APPLICATION', 'FOLLOW_UP', 'PROPOSAL'];
    if (!allowed.includes(kind)) {
      throw new Error(`kind must be one of ${allowed.join(', ')}`);
    }
    const company = typeof args.company === 'string' ? args.company.trim() : '';
    if (!company) {
      throw new Error('Provide the prospect company.');
    }

    let research = null;
    const researchId = typeof args.researchId === 'string' ? args.researchId.trim() : '';
    if (researchId && prisma) {
      const record = await prisma.companyResearch.findFirst({
        where: { id: researchId, userId: context.userId },
      });
      if (record) {
        research = record.findings as Record<string, unknown> | null;
      }
    }

    const result = await generatePitch({
      kind: kind as 'COLD_EMAIL' | 'LINKEDIN' | 'JOB_APPLICATION' | 'FOLLOW_UP' | 'PROPOSAL',
      company,
      recipientName: typeof args.recipientName === 'string' ? args.recipientName : undefined,
      opportunityDescription:
        typeof args.opportunityDescription === 'string' ? args.opportunityDescription : undefined,
      serviceName: typeof args.serviceName === 'string' ? args.serviceName : undefined,
      research,
      context: typeof args.context === 'string' ? args.context : undefined,
      tone: typeof args.tone === 'string' ? args.tone : undefined,
    });
    return JSON.stringify(result, null, 2);
  },
};

export const salesNextBestActionTool: Tool = {
  name: 'sales_next_best_action',
  description:
    'For an active lead, recommend the next best action: what should happen next, why, priority, and recommended timing (e.g. "follow up because the proposal was sent 4 days ago").',
  parameters: {
    type: 'object',
    properties: {
      leadId: {
        type: 'string',
        description: 'Id of the lead.',
      },
      context: {
        type: 'string',
        description: 'Optional context, e.g. "they opened the proposal yesterday".',
      },
    },
    required: ['leadId'],
  },
  async execute(args, context) {
    const leadId = typeof args.leadId === 'string' ? args.leadId.trim() : '';
    if (!leadId || !prisma) {
      throw new Error('Provide a valid leadId and ensure the database is configured.');
    }
    const lead = await prisma.lead.findFirst({ where: { id: leadId, userId: context.userId } });
    if (!lead) {
      throw new Error('Lead not found');
    }
    const action = await nextBestAction({
      lead: {
        ...lead,
        estimatedValue: lead.estimatedValue?.toString() ?? null,
      },
      context: typeof args.context === 'string' ? args.context : undefined,
    });
    return JSON.stringify(action, null, 2);
  },
};

export const salesPipelineSummaryTool: Tool = {
  name: 'sales_pipeline_summary',
  description:
    "Summarize the user's sales pipeline: total leads and opportunities, pipeline value, high-priority opportunities, follow-ups due, deals won/lost, and the conversion rate.",
  parameters: {
    type: 'object',
    properties: {},
  },
  async execute(_args, context) {
    if (!prisma) {
      throw new Error('Database not configured');
    }
    const [leadCount, won, lost, followUpsDue, opportunityCount, highPriority] = await Promise.all([
      prisma.lead.count({ where: { userId: context.userId } }),
      prisma.lead.count({ where: { userId: context.userId, status: 'WON' } }),
      prisma.lead.count({ where: { userId: context.userId, status: 'LOST' } }),
      prisma.lead.count({
        where: {
          userId: context.userId,
          status: { notIn: ['WON', 'LOST'] },
          nextFollowUpAt: { lte: new Date() },
        },
      }),
      prisma.opportunity.count({ where: { userId: context.userId } }),
      prisma.opportunity.count({ where: { userId: context.userId, score: { gte: 70 } } }),
    ]);
    const leads = await prisma.lead.findMany({
      where: { userId: context.userId, status: { notIn: ['WON', 'LOST'] } },
      select: { estimatedValue: true },
    });
    const pipelineValue = leads.reduce(
      (sum, lead) => sum + (lead.estimatedValue ? lead.estimatedValue.toNumber() : 0),
      0,
    );
    const closed = won + lost;
    return JSON.stringify(
      {
        pipelineValue,
        leads: leadCount,
        opportunities: opportunityCount,
        highPriorityOpportunities: highPriority,
        followUpsDue,
        dealsWon: won,
        dealsLost: lost,
        conversionRate: closed > 0 ? Math.round((won / closed) * 100) : 0,
      },
      null,
      2,
    );
  },
};

export const salesEstimatePriceTool: Tool = {
  name: 'sales_estimate_price',
  description:
    'Estimate a price for a service from the user\'s service catalog (minimum price, suggested price that preserves the target margin). Use when the user asks "what should I charge?".',
  parameters: {
    type: 'object',
    properties: {
      serviceName: {
        type: 'string',
        description: 'The service name from the catalog.',
      },
    },
    required: ['serviceName'],
  },
  async execute(args, context) {
    const serviceName = typeof args.serviceName === 'string' ? args.serviceName.trim() : '';
    if (!serviceName) {
      throw new Error('Provide a serviceName.');
    }
    const services = await listServices({ userId: context.userId, activeOnly: true });
    const service = services.find((item) => item.name.toLowerCase() === serviceName.toLowerCase());
    if (!service) {
      throw new Error(
        `Service "${serviceName}" not found in the catalog. Available: ${services.map((item) => item.name).join(', ') || 'none'}`,
      );
    }
    const estimate = estimatePrice(service);
    return JSON.stringify(
      {
        service: service.name,
        ...estimate,
      },
      null,
      2,
    );
  },
};

export const salesDiscoverOpportunitiesTool: Tool = {
  name: 'sales_discover_opportunities',
  description:
    'Discover business opportunities from safe, public sources. Provide a query (keyword search), a url (fetch a specific listing), or a companyWebsite (scan their public careers page). Returns normalized, de-duplicated candidates classified as JOB, POTENTIAL_CLIENT, or OUTSOURCING with a confidence reason. Optionally save them to the opportunities pipeline.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description:
          'Search query, e.g. "freelance react developer contract near me" or "marketing agency looking for web developer".',
      },
      url: {
        type: 'string',
        description: 'A specific opportunity URL to fetch and normalize.',
      },
      companyWebsite: {
        type: 'string',
        description: 'A company website to scan for job openings (e.g. https://example.com).',
      },
      sources: {
        type: 'string',
        description: `Comma-separated adapter ids to search. Defaults to all: ${listSourceAdapters()
          .map((adapter) => adapter.id)
          .join(', ')}.`,
      },
      save: {
        type: 'string',
        description: 'Set to "true" to save discovered opportunities into the pipeline.',
      },
    },
  },
  async execute(args, context) {
    const query = typeof args.query === 'string' ? args.query.trim() : undefined;
    const url = typeof args.url === 'string' ? args.url.trim() : undefined;
    const companyWebsite =
      typeof args.companyWebsite === 'string' ? args.companyWebsite.trim() : undefined;
    if (!query && !url && !companyWebsite) {
      throw new Error('Provide a query, url, or companyWebsite to discover opportunities.');
    }
    const sources =
      typeof args.sources === 'string'
        ? args.sources
            .split(',')
            .map((source) => source.trim())
            .filter(Boolean)
        : undefined;
    const save = typeof args.save === 'string' ? args.save.toLowerCase() === 'true' : false;

    const result = await discoverOpportunities({ query, url, companyWebsite, sources });
    const candidates = result.candidates.map((candidate) => {
      const { type, reason } = classifyCandidate(candidate);
      return { ...candidate, type, typeReason: reason };
    });

    let savedCount = 0;
    if (save && prisma) {
      for (const candidate of result.candidates) {
        try {
          const { type } = classifyCandidate(candidate);
          const userSkills: string[] = [];
          const memory = await prisma.memory.findMany({
            where: { userId: context.userId },
            take: 100,
            select: { key: true, value: true },
          });
          for (const entry of memory) {
            const text = `${entry.key} ${entry.value}`.toLowerCase();
            if (
              ['skills', 'skill', 'stack', 'technologies', 'expertise', 'experience'].some((tag) =>
                entry.key.toLowerCase().includes(tag),
              )
            ) {
              userSkills.push(text);
            }
          }
          const score = scoreOpportunity({
            type: type as never,
            estimatedBudget: candidate.estimatedBudget,
            urgency: candidate.urgency ?? null,
            source: candidate.source,
            requiredSkills: candidate.requiredSkills ?? [],
            userSkills,
          });
          await prisma.opportunity.create({
            data: {
              userId: context.userId,
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
          savedCount += 1;
        } catch {
          // Skip candidates that fail to save (e.g. duplicates).
        }
      }
    }

    return JSON.stringify(
      {
        candidates,
        savedCount,
        errors: result.errors,
        note: 'Discovered opportunities are unverified. Review before pursuing.',
      },
      null,
      2,
    );
  },
};

export const salesBuildPersonaTool: Tool = {
  name: 'sales_build_persona',
  description:
    'Build a buyer persona for a prospect so outreach and negotiation are personalized: likely goals, challenges, buying drivers, decision style, preferred channel, and communication tips. Grounds itself in saved company research when available and never invents facts.',
  parameters: {
    type: 'object',
    properties: {
      companyName: {
        type: 'string',
        description: 'The prospect company.',
      },
      researchId: {
        type: 'string',
        description: 'Optional id of a saved company research record.',
      },
      opportunityId: {
        type: 'string',
        description: 'Optional id of a saved opportunity to derive the persona from.',
      },
      context: {
        type: 'string',
        description: 'Optional extra context.',
      },
    },
  },
  async execute(args, context) {
    if (!prisma) {
      throw new Error('Database not configured');
    }
    const companyName = typeof args.companyName === 'string' ? args.companyName.trim() : '';
    const researchId = typeof args.researchId === 'string' ? args.researchId.trim() : '';
    const opportunityId = typeof args.opportunityId === 'string' ? args.opportunityId.trim() : '';
    if (!companyName && !opportunityId) {
      throw new Error('Provide a companyName or opportunityId.');
    }

    let research: Record<string, unknown> | null = null;
    if (researchId) {
      const record = await prisma.companyResearch.findFirst({
        where: { id: researchId, userId: context.userId },
      });
      if (record) {
        research = record.findings as Record<string, unknown> | null;
      }
    }
    let opportunityTitle: string | undefined;
    if (opportunityId) {
      const opportunity = await prisma.opportunity.findFirst({
        where: { id: opportunityId, userId: context.userId },
      });
      if (opportunity) {
        opportunityTitle = opportunity.title;
      }
    }

    const result = await buildPersona({
      companyName,
      research,
      opportunityTitle,
      context: typeof args.context === 'string' ? args.context : undefined,
    });
    return JSON.stringify(result, null, 2);
  },
};

export const salesDesignOfferTool: Tool = {
  name: 'sales_design_offer',
  description:
    'Design a tailored offer for a prospect or opportunity from the service catalog: name, description, deliverables, suggested and minimum price, target margin, delivery estimate, validity, rationale, and warnings. Grounds pricing in the catalog minimums; never fabricates prospect facts.',
  parameters: {
    type: 'object',
    properties: {
      companyName: {
        type: 'string',
        description: 'The prospect company.',
      },
      researchId: {
        type: 'string',
        description: 'Optional id of a saved company research record.',
      },
      opportunityId: {
        type: 'string',
        description: 'Optional id of a saved opportunity to design the offer for.',
      },
      opportunityDescription: {
        type: 'string',
        description: 'Optional description of the opportunity or problem being solved.',
      },
      context: {
        type: 'string',
        description: 'Optional extra context.',
      },
    },
  },
  async execute(args, context) {
    if (!prisma) {
      throw new Error('Database not configured');
    }
    const companyName = typeof args.companyName === 'string' ? args.companyName.trim() : '';
    const researchId = typeof args.researchId === 'string' ? args.researchId.trim() : '';
    const opportunityId = typeof args.opportunityId === 'string' ? args.opportunityId.trim() : '';
    if (!companyName && !opportunityId) {
      throw new Error('Provide a companyName or opportunityId.');
    }

    let research: Record<string, unknown> | null = null;
    if (researchId) {
      const record = await prisma.companyResearch.findFirst({
        where: { id: researchId, userId: context.userId },
      });
      if (record) {
        research = record.findings as Record<string, unknown> | null;
      }
    }
    let opportunityDescription =
      typeof args.opportunityDescription === 'string' ? args.opportunityDescription : undefined;
    if (opportunityId) {
      const opportunity = await prisma.opportunity.findFirst({
        where: { id: opportunityId, userId: context.userId },
      });
      if (opportunity) {
        opportunityDescription =
          opportunityDescription ?? opportunity.description ?? opportunity.title;
      }
    }

    const services = await loadCatalogForOffer(context.userId);
    const result = await designOffer({
      companyName,
      research,
      opportunityDescription,
      services,
      context: typeof args.context === 'string' ? args.context : undefined,
    });
    return JSON.stringify(result, null, 2);
  },
};

export const salesPrepareObjectionsTool: Tool = {
  name: 'sales_prepare_objections',
  description:
    'Prepare for objections before they happen: likely objections a prospect will raise, honest value-based responses, signals that an objection is coming, and facts to gather in advance. Never manipulative and never invents prospect facts.',
  parameters: {
    type: 'object',
    properties: {
      companyName: {
        type: 'string',
        description: 'The prospect company.',
      },
      researchId: {
        type: 'string',
        description: 'Optional id of a saved company research record.',
      },
      opportunityId: {
        type: 'string',
        description: 'Optional id of a saved opportunity.',
      },
      offer: {
        type: 'string',
        description: 'The offer under discussion.',
      },
      price: {
        type: 'string',
        description: 'The price under discussion, e.g. "$8,000".',
      },
      context: {
        type: 'string',
        description: 'Optional extra context.',
      },
    },
  },
  async execute(args, context) {
    if (!prisma) {
      throw new Error('Database not configured');
    }
    const companyName = typeof args.companyName === 'string' ? args.companyName.trim() : '';
    const researchId = typeof args.researchId === 'string' ? args.researchId.trim() : '';
    const opportunityId = typeof args.opportunityId === 'string' ? args.opportunityId.trim() : '';
    if (!companyName && !opportunityId) {
      throw new Error('Provide a companyName or opportunityId.');
    }

    let research: Record<string, unknown> | null = null;
    if (researchId) {
      const record = await prisma.companyResearch.findFirst({
        where: { id: researchId, userId: context.userId },
      });
      if (record) {
        research = record.findings as Record<string, unknown> | null;
      }
    }
    let opportunityDescription: string | undefined;
    if (opportunityId) {
      const opportunity = await prisma.opportunity.findFirst({
        where: { id: opportunityId, userId: context.userId },
      });
      if (opportunity) {
        opportunityDescription = opportunity.description ?? opportunity.title;
      }
    }

    const result = await prepareObjections({
      companyName,
      research,
      opportunityDescription,
      offer: typeof args.offer === 'string' ? args.offer : undefined,
      price: typeof args.price === 'string' ? args.price : undefined,
      context: typeof args.context === 'string' ? args.context : undefined,
    });
    return JSON.stringify(result, null, 2);
  },
};

export const salesNegotiationStrategyTool: Tool = {
  name: 'sales_negotiation_strategy',
  description:
    'Build a negotiation strategy for a specific deal: overall approach, price anchors (opening, target, walk-away), concessions with return asks, tactics, red flags, and next steps. Protects margin; the walk-away never dips below the minimum price unless scope is cut to compensate.',
  parameters: {
    type: 'object',
    properties: {
      companyName: {
        type: 'string',
        description: 'The prospect company.',
      },
      researchId: {
        type: 'string',
        description: 'Optional id of a saved company research record.',
      },
      opportunityId: {
        type: 'string',
        description: 'Optional id of a saved opportunity.',
      },
      offer: {
        type: 'string',
        description: 'The offer under negotiation.',
      },
      minimumPrice: {
        type: 'string',
        description: 'The minimum acceptable price (never go below without cutting scope).',
      },
      targetPrice: {
        type: 'string',
        description: 'The target price.',
      },
      currency: {
        type: 'string',
        description: 'Currency, default USD.',
      },
      context: {
        type: 'string',
        description: 'Optional extra context.',
      },
    },
  },
  async execute(args, context) {
    if (!prisma) {
      throw new Error('Database not configured');
    }
    const companyName = typeof args.companyName === 'string' ? args.companyName.trim() : '';
    const researchId = typeof args.researchId === 'string' ? args.researchId.trim() : '';
    const opportunityId = typeof args.opportunityId === 'string' ? args.opportunityId.trim() : '';
    if (!companyName && !opportunityId) {
      throw new Error('Provide a companyName or opportunityId.');
    }

    let research: Record<string, unknown> | null = null;
    if (researchId) {
      const record = await prisma.companyResearch.findFirst({
        where: { id: researchId, userId: context.userId },
      });
      if (record) {
        research = record.findings as Record<string, unknown> | null;
      }
    }
    let opportunityDescription: string | undefined;
    if (opportunityId) {
      const opportunity = await prisma.opportunity.findFirst({
        where: { id: opportunityId, userId: context.userId },
      });
      if (opportunity) {
        opportunityDescription = opportunity.description ?? opportunity.title;
      }
    }

    const result = await buildNegotiationStrategy({
      companyName,
      research,
      opportunityDescription,
      offer: typeof args.offer === 'string' ? args.offer : undefined,
      minimumPrice:
        typeof args.minimumPrice === 'string' && args.minimumPrice !== ''
          ? Number(args.minimumPrice)
          : undefined,
      targetPrice:
        typeof args.targetPrice === 'string' && args.targetPrice !== ''
          ? Number(args.targetPrice)
          : undefined,
      currency: typeof args.currency === 'string' ? args.currency : undefined,
      context: typeof args.context === 'string' ? args.context : undefined,
    });
    return JSON.stringify(result, null, 2);
  },
};

export const salesAnalyzeMarginTool: Tool = {
  name: 'sales_analyze_margin',
  description:
    'Analyze the margin on a price: given a minimum price, target price, target margin, and optional estimated cost, returns whether the deal margin is healthy, thin, or at risk. Use when deciding whether a price is worth taking.',
  parameters: {
    type: 'object',
    properties: {
      minimumPrice: {
        type: 'string',
        description: 'The minimum price you can accept.',
      },
      targetPrice: {
        type: 'string',
        description: 'The price under consideration.',
      },
      targetMargin: {
        type: 'string',
        description: 'The target margin percent, e.g. 40.',
      },
      estimatedCost: {
        type: 'string',
        description: 'Optional estimated cost of delivering the work.',
      },
      currency: {
        type: 'string',
        description: 'Currency, default USD.',
      },
    },
  },
  async execute(args) {
    const parseNumber = (value: unknown): number | undefined => {
      if (typeof value === 'string' && value.trim() !== '') {
        const num = Number(value);
        return Number.isFinite(num) ? num : undefined;
      }
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
      }
      return undefined;
    };
    const result = analyzeMargin({
      minimumPrice: parseNumber(args.minimumPrice),
      targetPrice: parseNumber(args.targetPrice),
      targetMargin: parseNumber(args.targetMargin),
      estimatedCost: parseNumber(args.estimatedCost),
      currency: typeof args.currency === 'string' ? args.currency : undefined,
    });
    return JSON.stringify(result, null, 2);
  },
};

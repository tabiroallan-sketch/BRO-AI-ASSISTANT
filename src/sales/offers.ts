import { prisma } from '../lib/prisma.js';
import { estimatePrice, listServices } from './catalog.js';
import { salesCompletion, parseStructuredJson } from './llm.js';
import { salesMethodologyBlock } from './methodology.js';
import type { CompanyResearchResult, DesignedOffer } from './types.js';

export type OfferDesignInput = {
  companyName?: string;
  research?: CompanyResearchResult | null;
  opportunityDescription?: string;
  services: Array<{
    name: string;
    minimumPrice?: number | null;
    targetMargin?: number;
  }>;
  context?: string;
};

const OFFER_SYSTEM_PROMPT = `You are BRO, a consultative sales strategist who designs offers that close.

${salesMethodologyBlock()}

Base the offer on the services and prices supplied. Never invent facts about the prospect. Where you lack evidence, say so. Suggest prices from the supplied minimum prices (a reasonable margin above minimum) — do not fabricate costs.

Respond with ONLY valid JSON in this exact shape:
{
  "name": "a short, concrete offer name, e.g. Website + SEO Launch",
  "description": "what the client gets, in plain language",
  "components": ["each deliverable as a separate line"],
  "suggestedPrice": 0,
  "minimumPrice": 0,
  "targetMargin": 30,
  "currency": "USD",
  "deliveryEstimate": "e.g. 4-6 weeks",
  "validDays": 30,
  "rationale": "why this offer fits this prospect",
  "warnings": ["anything that must be verified before sending"]
}`;

export type OfferDesignResult = DesignedOffer & { warnings: string[] };

/**
 * Designs a tailored offer for an opportunity/prospect based on the user's
 * service catalog. Uses the LLM to compose services into a coherent deal with
 * a defensible price floor; stays grounded in the catalog's minimum prices.
 */
export async function designOffer(
  input: OfferDesignInput,
  preferredProviderId?: string,
): Promise<OfferDesignResult> {
  const researchBlock = input.research
    ? `Research:\n${JSON.stringify(input.research, null, 2)}`
    : 'No research supplied. Use only the opportunity description and mark inference as such.';

  const serviceBlock =
    input.services.length > 0
      ? input.services
          .map(
            (service) =>
              `- ${service.name}${service.minimumPrice ? ` (min $${service.minimumPrice})` : ''}`,
          )
          .join('\n')
      : 'No services supplied. Keep the offer generic and ask the user to pick services.';

  const userPrompt = [
    `Company: ${input.companyName ?? 'unknown'}`,
    input.opportunityDescription ? `Opportunity: ${input.opportunityDescription}` : '',
    `Service catalog available to BRO:\n${serviceBlock}`,
    input.context ? `Additional context: ${input.context}` : '',
    '',
    researchBlock,
  ]
    .filter((line) => line !== '')
    .join('\n');

  const result = await salesCompletion(
    {
      messages: [
        { role: 'system', content: OFFER_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.3,
      maxTokens: 1200,
    },
    preferredProviderId,
  );

  const parsed = parseStructuredJson<DesignedOffer>(result.content);
  if (parsed && parsed.name?.trim()) {
    return parsed;
  }
  throw new Error('AI returned an unparseable offer design. Please try again.');
}

export type SavedOfferInput = {
  userId: string;
  opportunityId?: string;
  leadId?: string;
  name: string;
  description?: string;
  components?: string[];
  suggestedPrice?: number;
  minimumPrice?: number;
  targetMargin?: number;
  currency?: string;
  deliveryEstimate?: string;
  validDays?: number;
  notes?: string;
};

/** Persists a designed offer, optionally linked to an opportunity or lead. */
export async function saveOffer(input: SavedOfferInput): Promise<unknown> {
  if (!prisma) {
    throw new Error('Database not configured');
  }
  return prisma.offer.create({
    data: {
      userId: input.userId,
      opportunityId: input.opportunityId,
      leadId: input.leadId,
      name: input.name,
      description: input.description ?? null,
      components: input.components ?? [],
      suggestedPrice: input.suggestedPrice ?? null,
      minimumPrice: input.minimumPrice ?? null,
      targetMargin: input.targetMargin ?? 30,
      currency: input.currency ?? 'USD',
      deliveryEstimate: input.deliveryEstimate ?? null,
      validDays: input.validDays ?? 30,
      notes: input.notes ?? null,
    },
  });
}

/** Loads the user's active service catalog into the compact offer input shape. */
export async function loadCatalogForOffer(
  userId: string,
  activeOnly = true,
): Promise<OfferDesignInput['services']> {
  const services = await listServices({ userId, activeOnly });
  return services.map((service) => {
    const estimate = estimatePrice(service);
    return {
      name: service.name,
      minimumPrice: estimate.minimumPrice || null,
      targetMargin: estimate.targetMargin,
    };
  });
}

import { salesCompletion, parseStructuredJson } from './llm.js';
import { salesMethodologyBlock } from './methodology.js';
import type { CompanyResearchResult, NegotiationStrategy } from './types.js';

export type NegotiationInput = {
  companyName?: string;
  research?: CompanyResearchResult | null;
  opportunityDescription?: string;
  offer?: string;
  minimumPrice?: number;
  targetPrice?: number;
  currency?: string;
  context?: string;
};

const NEGOTIATION_SYSTEM_PROMPT = `You are BRO, a consultative sales negotiator who protects margin without burning trust.

${salesMethodologyBlock()}

Ground the strategy in the numbers supplied (minimum price and target price). Never fabricate facts about the prospect. Walk-away price should never go below the minimum price unless the user explicitly asks to cut scope to compensate.

Respond with ONLY valid JSON in this exact shape:
{
  "strategy": "one-paragraph overall negotiation approach for this deal",
  "anchors": {
    "opening": "the opening number or position",
    "target": "the realistic target outcome",
    "walkAway": "the lowest acceptable outcome",
    "rationale": "why these anchors make sense"
  },
  "concessions": [{ "give": "what you can give", "getInReturn": "what to ask for in return" }],
  "tactics": ["step-by-step tactics to use during the negotiation"],
  "redFlags": ["signals that this buyer is unreasonable or the deal is at risk"],
  "nextSteps": ["concrete next actions"]
}`;

/**
 * Builds a negotiation strategy for a specific deal with price anchors
 * grounded in the user's minimum/target prices. Protects margin and returns a
 * concession plan with return asks.
 */
export async function buildNegotiationStrategy(
  input: NegotiationInput,
  preferredProviderId?: string,
): Promise<NegotiationStrategy> {
  const researchBlock = input.research
    ? `Research:\n${JSON.stringify(input.research, null, 2)}`
    : 'No research supplied. Keep the strategy general.';

  const userPrompt = [
    `Company: ${input.companyName ?? 'unknown'}`,
    input.opportunityDescription ? `Opportunity: ${input.opportunityDescription}` : '',
    input.offer ? `Offer under negotiation: ${input.offer}` : '',
    input.minimumPrice !== undefined
      ? `Minimum acceptable price: ${input.currency ?? 'USD'} ${input.minimumPrice}`
      : '',
    input.targetPrice !== undefined
      ? `Target price: ${input.currency ?? 'USD'} ${input.targetPrice}`
      : '',
    input.context ? `Additional context: ${input.context}` : '',
    '',
    researchBlock,
  ]
    .filter((line) => line !== '')
    .join('\n');

  const result = await salesCompletion(
    {
      messages: [
        { role: 'system', content: NEGOTIATION_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.3,
      maxTokens: 1200,
    },
    preferredProviderId,
  );

  const parsed = parseStructuredJson<NegotiationStrategy>(result.content);
  if (parsed && parsed.strategy?.trim()) {
    return parsed;
  }
  throw new Error('AI returned an unparseable negotiation strategy. Please try again.');
}

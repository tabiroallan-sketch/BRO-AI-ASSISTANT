import { salesCompletion, parseStructuredJson } from './llm.js';
import { salesMethodologyBlock } from './methodology.js';
import type { CompanyResearchResult, ObjectionPlaybook } from './types.js';

export type ObjectionsInput = {
  companyName?: string;
  research?: CompanyResearchResult | null;
  opportunityDescription?: string;
  offer?: string;
  price?: string;
  context?: string;
};

const OBJECTIONS_SYSTEM_PROMPT = `You are BRO, a consultative sales strategist who prepares for objections before they happen.

${salesMethodologyBlock()}

Never invent facts about the prospect. Responses must be honest, specific, and value-based — never manipulative. If a detail is unknown, say so in preparationNotes rather than guessing.

Respond with ONLY valid JSON in this exact shape:
{
  "objections": [
    {
      "objection": "the likely objection, phrased as the buyer would say it",
      "response": "how to respond honestly and keep the deal moving"
    }
  ],
  "signalsToWatchFor": ["things the buyer might say/do that indicate this objection is coming"],
  "preparationNotes": ["facts to gather ahead of time so responses are grounded"]
}`;

/**
 * Builds a pre-emptive objection playbook for a specific deal: likely
 * objections, honest responses, signals that they are coming, and what to
 * research in advance.
 */
export async function prepareObjections(
  input: ObjectionsInput,
  preferredProviderId?: string,
): Promise<ObjectionPlaybook> {
  const researchBlock = input.research
    ? `Research:\n${JSON.stringify(input.research, null, 2)}`
    : 'No research supplied. Keep responses general and flag what must be verified.';

  const userPrompt = [
    `Company: ${input.companyName ?? 'unknown'}`,
    input.opportunityDescription ? `Opportunity: ${input.opportunityDescription}` : '',
    input.offer ? `Offer under discussion: ${input.offer}` : '',
    input.price ? `Price under discussion: ${input.price}` : '',
    input.context ? `Additional context: ${input.context}` : '',
    '',
    researchBlock,
  ]
    .filter((line) => line !== '')
    .join('\n');

  const result = await salesCompletion(
    {
      messages: [
        { role: 'system', content: OBJECTIONS_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.3,
      maxTokens: 1200,
    },
    preferredProviderId,
  );

  const parsed = parseStructuredJson<ObjectionPlaybook>(result.content);
  if (parsed) {
    return parsed;
  }
  throw new Error('AI returned an unparseable objection playbook. Please try again.');
}

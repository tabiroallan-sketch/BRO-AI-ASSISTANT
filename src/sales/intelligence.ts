import { salesCompletion, parseStructuredJson } from './llm.js';
import { salesMethodologyBlock } from './methodology.js';
import type { CompanyResearchResult, ProspectAnalysis } from './types.js';

export type ProspectAnalysisInput = {
  companyName?: string;
  website?: string;
  research?: CompanyResearchResult | null;
  services?: string[];
  context?: string;
};

const INTELLIGENCE_SYSTEM_PROMPT = `You are BRO, a consultative sales strategist. You analyze prospects and recommend how to win them using value-based selling.

${salesMethodologyBlock()}

Ground every recommendation in the research supplied. Where you lack evidence, say so instead of guessing. Never invent facts about the prospect. Distinguish between what is known and what is inferred.

Respond with ONLY valid JSON in this exact shape:
{
  "summary": "1-2 sentence read on this prospect",
  "problems": ["the likely business problems, each concrete"],
  "buyingSignals": ["signals that suggest they are ready to buy"],
  "needsService": ["reasons they might need a service, tied to their situation"],
  "decisionMakers": ["who likely decides and why"],
  "recommendedOffer": {
    "service": "which service to lead with",
    "rationale": "why it fits their problems",
    "suggestedPrice": "a rough, honest price anchor"
  },
  "approach": {
    "strategy": "the overall approach, e.g. consultative framing or a specific framework",
    "channel": "the best channel to reach them",
    "messageHook": "the one-line hook the outreach should open with"
  },
  "objections": [{ "objection": "a likely objection", "response": "how to respond" }],
  "nextBestAction": {
    "action": "the single most useful next step",
    "why": "why that step now",
    "priority": "high|medium|low",
    "timing": "when to do it",
    "channel": "which channel"
  }
}`;

/**
 * Analyzes a prospect (potential client) and produces a structured,
 * consultative assessment: likely problems, buying signals, needs, decision
 * makers, recommended offer/approach, objections, and next best action.
 */
export async function analyzeProspect(
  input: ProspectAnalysisInput,
  preferredProviderId?: string,
): Promise<ProspectAnalysis> {
  const researchBlock = input.research
    ? `Research on this prospect:\n${JSON.stringify(input.research, null, 2)}`
    : 'No pre-run research was supplied. Rely only on the details given and clearly mark inferences.';

  const userPrompt = [
    `Prospect company: ${input.companyName ?? 'unknown'}`,
    `Website: ${input.website ?? 'unknown'}`,
    `Services BRO can offer: ${(input.services ?? []).join(', ') || 'not specified'}`,
    input.context ? `Additional context: ${input.context}` : '',
    '',
    researchBlock,
  ]
    .filter((line) => line !== '')
    .join('\n');

  const result = await salesCompletion(
    {
      messages: [
        { role: 'system', content: INTELLIGENCE_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.3,
      maxTokens: 1500,
    },
    preferredProviderId,
  );

  const parsed = parseStructuredJson<ProspectAnalysis>(result.content);
  if (parsed) {
    return parsed;
  }
  throw new Error('AI returned an unparseable prospect analysis. Please try again.');
}

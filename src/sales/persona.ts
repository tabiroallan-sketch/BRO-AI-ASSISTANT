import { salesCompletion, parseStructuredJson } from './llm.js';
import { salesMethodologyBlock } from './methodology.js';
import type { CompanyResearchResult, PersonaProfile } from './types.js';

export type PersonaInput = {
  companyName?: string;
  research?: CompanyResearchResult | null;
  opportunityTitle?: string;
  context?: string;
};

const PERSONA_SYSTEM_PROMPT = `You are BRO, a sales strategist who builds buyer personas to improve outreach.

${salesMethodologyBlock()}

Ground every statement in the research supplied. Where you lack evidence, say so instead of guessing. Never invent facts about the person or company. Distinguish what is known from what is inferred, and note it in signalsObserved or warnings.

Respond with ONLY valid JSON in this exact shape:
{
  "title": "short persona label, e.g. Head of Operations at Acme",
  "summary": "2-3 sentence read on this buyer and their situation",
  "role": "the likely decision-maker role",
  "likelyGoals": ["goals this person is likely measured on"],
  "likelyChallenges": ["pressures this person likely faces"],
  "buyingDrivers": ["what would push them to say yes"],
  "decisionStyle": "how they likely decide, e.g. consensus-driven, cost-focused, speed-focused",
  "preferredChannel": "the best channel to reach them",
  "communicationTips": ["how to phrase outreach for this buyer"],
  "signalsObserved": ["only signals that are actually present in the research"],
  "warnings": ["anything unverified that must be checked before outreach"]
}`;

/**
 * Builds a buyer persona for a prospect based on research. Used to personalize
 * outreach and negotiation. Never fabricates facts about the buyer; inference
 * is labeled.
 */
export async function buildPersona(
  input: PersonaInput,
  preferredProviderId?: string,
): Promise<PersonaProfile> {
  const researchBlock = input.research
    ? `Research:\n${JSON.stringify(input.research, null, 2)}`
    : 'No research supplied. Mark everything as inferred and recommend gathering facts before outreach.';

  const userPrompt = [
    `Company: ${input.companyName ?? 'unknown'}`,
    input.opportunityTitle ? `Opportunity: ${input.opportunityTitle}` : '',
    input.context ? `Additional context: ${input.context}` : '',
    '',
    researchBlock,
  ]
    .filter((line) => line !== '')
    .join('\n');

  const result = await salesCompletion(
    {
      messages: [
        { role: 'system', content: PERSONA_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.3,
      maxTokens: 1000,
    },
    preferredProviderId,
  );

  const parsed = parseStructuredJson<PersonaProfile>(result.content);
  if (parsed) {
    return parsed;
  }
  throw new Error('AI returned an unparseable persona. Please try again.');
}

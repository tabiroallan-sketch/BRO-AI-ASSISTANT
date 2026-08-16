import { salesCompletion, parseStructuredJson } from './llm.js';
import { salesMethodologyBlock } from './methodology.js';
import type { CompanyResearchResult, SalesDraftKindValue } from './types.js';

export type PitchKind = Exclude<SalesDraftKindValue, never>;

export type PitchInput = {
  kind: SalesDraftKindValue;
  company: string;
  recipientName?: string;
  recipientTitle?: string;
  opportunityDescription?: string;
  research?: CompanyResearchResult | null;
  serviceName?: string;
  serviceDescription?: string;
  suggestedPrice?: string;
  context?: string;
  tone?: string;
};

export type PitchResult = {
  subject?: string;
  body: string;
  nextSteps?: string[];
  warnings?: string[];
};

const KIND_GUIDANCE: Record<SalesDraftKindValue, string> = {
  COLD_EMAIL:
    'A cold outreach email to a potential client. Open with something specific to their company, name their problem, imply the cost of inaction, and end with one low-friction call to action. Keep under 150 words.',
  LINKEDIN:
    'A short LinkedIn message. One hook, one reason to talk, one soft call to action. Under 80 words.',
  JOB_APPLICATION:
    'A job application cover message. Focus on the concrete value the applicant would bring to that role and company. Do NOT invent experience, skills, metrics, or testimonials; reference only what is actually true, and flag anything that should be verified.',
  FOLLOW_UP:
    'A follow-up to someone who has not responded yet. Brief, respectful, value-adds (new idea or useful link), never guilt-trippy, under 90 words.',
  PROPOSAL:
    'The introduction of a proposal for a prospective client. Summarize their problem, the recommended solution, expected outcome, and next steps. No fabricated numbers; leave specific figures bracketed for the user to confirm.',
};

const PITCH_SYSTEM_PROMPT = `You are BRO, a consultative sales writer. You write outreach that gets replies because it is specific, honest, and useful.

${salesMethodologyBlock()}

Safety rules (non-negotiable):
- Never invent experience, statistics, testimonials, case studies, or portfolio items.
- Never fabricate anything about the company or the recipient.
- Never use spam patterns ("I hope this finds you well", "I am a talented developer", fake urgency, flattery).
- If the research lacks a detail, omit it or ask for it rather than making it up.

Respond with ONLY valid JSON in this exact shape:
{
  "subject": "email subject line (omit for LinkedIn or short messages)",
  "body": "the full message",
  "nextSteps": ["1-3 suggested next steps for the user"],
  "warnings": ["anything that must be verified before sending, e.g. facts the model inferred"]
}`;

/**
 * Generates a personalized outreach/pitch message for a specific prospect.
 * Focuses on the prospect's problem and business outcome, never on generic
 * self-promotion. Returns a structured result the caller can save as a draft
 * that requires user approval before it can be sent.
 */
export async function generatePitch(
  input: PitchInput,
  preferredProviderId?: string,
): Promise<PitchResult> {
  const kindGuidance = KIND_GUIDANCE[input.kind] ?? KIND_GUIDANCE.COLD_EMAIL;

  const researchBlock = input.research
    ? `Research on the company:\n${JSON.stringify(input.research, null, 2)}`
    : 'No research supplied. Do not invent company facts; use only what is provided.';

  const userPrompt = [
    `Message type: ${input.kind} (${kindGuidance})`,
    `Company: ${input.company}`,
    input.recipientName
      ? `Recipient: ${input.recipientName}${input.recipientTitle ? `, ${input.recipientTitle}` : ''}`
      : '',
    input.opportunityDescription ? `Opportunity: ${input.opportunityDescription}` : '',
    input.serviceName
      ? `Service to pitch: ${input.serviceName}${input.serviceDescription ? ` — ${input.serviceDescription}` : ''}`
      : '',
    input.suggestedPrice ? `Price anchor (verify before use): ${input.suggestedPrice}` : '',
    input.context ? `Additional context: ${input.context}` : '',
    input.tone ? `Tone: ${input.tone}` : '',
    '',
    researchBlock,
  ]
    .filter((line) => line !== '')
    .join('\n');

  const result = await salesCompletion(
    {
      messages: [
        { role: 'system', content: PITCH_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.6,
      maxTokens: 1000,
    },
    preferredProviderId,
  );

  const parsed = parseStructuredJson<PitchResult>(result.content);
  if (parsed && parsed.body?.trim()) {
    return parsed;
  }
  throw new Error('AI returned an unparseable pitch. Please try again.');
}

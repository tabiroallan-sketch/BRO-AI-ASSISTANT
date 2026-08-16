import { isAiConfigured, salesCompletion, parseStructuredJson } from './llm.js';
import { salesMethodologyBlock } from './methodology.js';
import type { CompanyResearchResult, LeadLike, NextBestAction } from './types.js';

export type NextBestActionInput = {
  lead: LeadLike;
  research?: CompanyResearchResult | null;
  context?: string;
};

const NEXT_ACTION_SYSTEM_PROMPT = `You are BRO, a sales operations assistant. For the lead described, decide the single most useful next step.

${salesMethodologyBlock()}

Rules:
- Base your recommendation on the lead's status, how long it has been since last contact, whether a follow-up is due, and any context provided.
- Never invent facts about the lead; work only with what is given.
- Keep the action concrete, specific, and immediately executable.

Respond with ONLY valid JSON in this exact shape:
{
  "action": "what to do next",
  "why": "why this now, tied to the lead's situation",
  "priority": "high|medium|low",
  "timing": "when, e.g. 'today' or 'within 3 days'",
  "channel": "email | linkedin | phone | call | meeting | ..."
}`;

function daysBetween(a: Date, b: Date): number {
  return Math.floor((a.getTime() - b.getTime()) / 86_400_000);
}

function leadTiming(lead: LeadLike, now: Date): string | null {
  if (lead.nextFollowUpAt) {
    const due = new Date(lead.nextFollowUpAt);
    if (due.getTime() <= now.getTime()) {
      return 'overdue';
    }
    return `scheduled ${due.toISOString().slice(0, 10)}`;
  }
  return null;
}

/** Deterministic baseline used when AI is not configured (or as a sanity check). */
export function heuristicNextBestAction(lead: LeadLike, now = new Date()): NextBestAction {
  const timing = leadTiming(lead, now);

  if (lead.status === 'WON') {
    return {
      action: 'Onboard the client and confirm the first delivery milestone.',
      why: 'The deal is won; the priority is starting work and proving value quickly.',
      priority: 'high',
      timing: 'Today',
      channel: 'email',
    };
  }
  if (lead.status === 'LOST') {
    return {
      action: 'Log the reason lost and set a re-engagement reminder in 90 days.',
      why: 'The deal is lost; preserve the relationship for future opportunities.',
      priority: 'low',
      timing: 'Within a week',
      channel: 'notes',
    };
  }

  if (timing === 'overdue' || timing?.startsWith('scheduled')) {
    const lastContactDays =
      lead.lastContactAt !== null && lead.lastContactAt
        ? daysBetween(new Date(lead.lastContactAt), now)
        : null;
    const stale = lastContactDays !== null && lastContactDays >= 4;
    return {
      action: stale
        ? `Follow up with ${lead.name} — they have not been contacted in ${lastContactDays} days.`
        : `Follow up with ${lead.name} now that the scheduled follow-up is ${timing}.`,
      why:
        timing === 'overdue'
          ? 'The follow-up date has passed and the lead is waiting.'
          : 'The follow-up date is scheduled; reaching out now keeps the deal moving.',
      priority: 'high',
      timing: 'Today',
      channel: lead.email ? 'email' : 'linkedin',
    };
  }

  switch (lead.status) {
    case 'NEW':
      return {
        action: 'Qualify the lead: confirm budget, authority, need, and timeline (BANT).',
        why: 'The lead is new; a quick qualification call decides whether to invest time.',
        priority: 'high',
        timing: 'Within 48 hours',
        channel: 'email',
      };
    case 'QUALIFIED':
      return {
        action: 'Start a conversation with a consultative message tied to their problem.',
        why: 'The lead is qualified but not yet contacted; the first touch should be value-led.',
        priority: 'high',
        timing: 'Today',
        channel: lead.email ? 'email' : 'linkedin',
      };
    case 'CONTACTED':
      return {
        action: 'Prepare for the response: research their company and ready a discovery agenda.',
        why: 'Contact was made; the next response must move them to a meeting.',
        priority: 'medium',
        timing: 'Within 2 days',
        channel: 'email',
      };
    case 'RESPONDED':
      return {
        action: 'Book a discovery meeting and confirm the agenda.',
        why: 'They responded; converting to a meeting is the clear next step.',
        priority: 'high',
        timing: 'Today',
        channel: 'email',
      };
    case 'MEETING':
      return {
        action: 'Send the discovery summary and next steps from the meeting.',
        why: 'A meeting happened; a written summary prevents the deal from stalling.',
        priority: 'high',
        timing: 'Today',
        channel: 'email',
      };
    case 'PROPOSAL':
      return {
        action: 'Follow up on the proposal within 4 days if no response, with a value-add.',
        why: 'The proposal is out; a timed, value-adding follow-up keeps momentum without nagging.',
        priority: 'medium',
        timing: 'Within 4 days',
        channel: 'email',
      };
    case 'NEGOTIATION':
      return {
        action: 'Confirm the remaining open points and the decision timeline.',
        why: 'Negotiation is active; closing open items prevents drift.',
        priority: 'high',
        timing: 'Within 2 days',
        channel: 'email',
      };
    default:
      return {
        action: 'Review the lead notes and decide the next meaningful touch.',
        why: 'The lead has no scheduled next step.',
        priority: 'low',
        timing: 'Within a week',
        channel: 'email',
      };
  }
}

/**
 * Determines the next best action for a lead. Uses a deterministic heuristic
 * based on pipeline stage and timing, then enriches it with an LLM when AI is
 * configured. Always returns a sane default so callers never block on AI.
 */
export async function nextBestAction(
  input: NextBestActionInput,
  preferredProviderId?: string,
): Promise<NextBestAction> {
  const heuristic = heuristicNextBestAction(input.lead);

  if (!input.lead.id || !isAiConfigured()) {
    return heuristic;
  }

  const researchBlock = input.research
    ? `\nResearch on the lead's company:\n${JSON.stringify(input.research, null, 2)}`
    : '';

  try {
    const userPrompt = [
      `Lead: ${JSON.stringify(input.lead, null, 2)}`,
      input.context ? `Context: ${input.context}` : '',
      researchBlock,
      `Heuristic suggestion (confirm, refine, or improve): ${heuristic.action}`,
    ]
      .filter((line) => line !== '')
      .join('\n');

    const result = await salesCompletion(
      {
        messages: [
          { role: 'system', content: NEXT_ACTION_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.3,
        maxTokens: 400,
      },
      preferredProviderId,
    );

    const parsed = parseStructuredJson<NextBestAction>(result.content);
    if (parsed?.action?.trim()) {
      return parsed;
    }
  } catch {
    // Fall through to the heuristic.
  }
  return heuristic;
}

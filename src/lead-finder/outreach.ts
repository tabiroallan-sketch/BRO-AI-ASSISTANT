import { salesCompletion, parseStructuredJson } from '../sales/llm.js';
import { salesMethodologyBlock } from '../sales/methodology.js';
import type { DedupedLead, RawLead } from './types.js';

export type OutreachTone = 'professional' | 'friendly' | 'direct' | 'short' | 'consultative';

export type OutreachResult = {
  subject?: string;
  body: string;
  channel: string;
  tone: OutreachTone;
};

const OUTREACH_SYSTEM_PROMPT = `You are BRO's outreach generation AI. Create personalized outreach messages based on lead information.

CRITICAL RULES:
- NEVER fabricate facts about the business.
- If you don't know something, don't make it up.
- Only reference information that was provided about the lead.
- Distinguish between what is VERIFIED (provided) vs INFERRED (your deduction).
- Focus on the business problems your services solve.

When the request mentions hiring activity, you may reference that since it's an observed fact.
When mentioning automation opportunities, label them as suggestions/inferences.

${salesMethodologyBlock()}

Respond with ONLY valid JSON:
{
  "subject": "email subject line (null for non-email channels)",
  "body": "the outreach message",
  "tone": "the tone used"
}`;

function buildOutreachContext(lead: RawLead | DedupedLead, customContext?: string): string {
  const parts: string[] = [];
  parts.push(`Company: ${lead.companyName}`);
  if (lead.industry) parts.push(`Industry: ${lead.industry}`);
  if (lead.companyDescription) parts.push(`Description: ${lead.companyDescription}`);
  if (lead.city || lead.state || lead.country) {
    parts.push(`Location: ${[lead.city, lead.state, lead.country].filter(Boolean).join(', ')}`);
  }
  if (lead.website) parts.push(`Website: ${lead.website}`);
  if ('sources' in lead) parts.push(`Sources: ${(lead as DedupedLead).sources.join(', ')}`);

  const hiring = ('hiringSignals' in lead ? (lead as DedupedLead).hiringSignals : []) ?? [];
  if (hiring.length) parts.push(`Observed hiring signals: ${hiring.join('; ')}`);

  const intent = ('intentSignals' in lead ? (lead as DedupedLead).intentSignals : []) ?? [];
  if (intent.length) parts.push(`Intent signals: ${intent.join('; ')}`);

  const painPoints = ('painPoints' in lead ? (lead as DedupedLead).painPoints : []) ?? [];
  if (painPoints.length) parts.push(`Possible pain points: ${painPoints.join('; ')}`);

  const autoOpps =
    ('automationOpportunities' in lead ? (lead as DedupedLead).automationOpportunities : []) ?? [];
  if (autoOpps.length) parts.push(`Automation opportunities: ${autoOpps.join('; ')}`);

  if (customContext) parts.push(`Additional context: ${customContext}`);

  return parts.join('\n');
}

export async function generateOutreach(
  lead: RawLead | DedupedLead,
  channel: string,
  tone: OutreachTone = 'professional',
  customContext?: string,
  preferredProviderId?: string,
): Promise<OutreachResult> {
  const context = buildOutreachContext(lead, customContext);

  const userPrompt = `Generate a ${tone} ${channel} outreach message for this lead:\n\n${context}`;

  try {
    const result = await salesCompletion(
      {
        messages: [
          { role: 'system', content: OUTREACH_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.3,
        maxTokens: 800,
      },
      preferredProviderId,
    );

    const parsed = parseStructuredJson<{
      subject?: string;
      body: string;
      tone?: string;
    }>(result.content);

    if (parsed) {
      return {
        subject: parsed.subject,
        body: parsed.body,
        channel,
        tone: (parsed.tone as OutreachTone) ?? tone,
      };
    }
  } catch {
    // Fall through to basic outreach
  }

  return basicOutreach(lead, channel, tone);
}

function basicOutreach(
  lead: RawLead | DedupedLead,
  channel: string,
  tone: OutreachTone,
): OutreachResult {
  const isEmail = channel === 'cold_email';
  const company = lead.companyName;
  const greeting = tone === 'friendly' ? `Hi there` : `Hello`;
  const opener =
    tone === 'consultative'
      ? `I noticed ${company} is in the ${lead.industry ?? 'business'} space, and I wanted to reach out about how AI automation could help streamline your operations.`
      : `I'm reaching out to ${company} because we help businesses automate repetitive tasks and improve efficiency.`;

  const body = `${greeting},\n\n${opener}\n\nWe specialize in AI-powered solutions that help businesses like yours save time and reduce manual work. I'd love to learn more about your current processes and see how we might help.\n\nWould you be open to a brief conversation?\n\nBest regards`;

  return {
    subject: isEmail ? `AI Automation for ${company}` : undefined,
    body,
    channel,
    tone,
  };
}

export async function generateMultiChannelOutreach(
  lead: RawLead | DedupedLead,
  channels: string[],
  tone: OutreachTone = 'professional',
  customContext?: string,
  preferredProviderId?: string,
): Promise<OutreachResult[]> {
  const results: OutreachResult[] = [];
  for (const channel of channels) {
    const result = await generateOutreach(lead, channel, tone, customContext, preferredProviderId);
    results.push(result);
  }
  return results;
}

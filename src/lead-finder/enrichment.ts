import { salesCompletion, parseStructuredJson } from '../sales/llm.js';
import { salesMethodologyBlock } from '../sales/methodology.js';
import type { DedupedLead, LeadEnrichment, LeadScoreBreakdown, RawLead } from './types.js';

const ENRICHMENT_SYSTEM_PROMPT = `You are BRO's lead enrichment AI. Analyze a business lead and generate an enriched profile based on the information provided.

IMPORTANT RULES:
- Distinguish between VERIFIED (directly stated), LIKELY (strong evidence), INFERRED (reasonable deduction), and UNKNOWN (insufficient data) information.
- NEVER fabricate company information. If data is missing, mark it UNKNOWN.
- Never claim a business definitely has a problem when you only inferred it.
- Be helpful but honest.

${salesMethodologyBlock()}

Respond with ONLY valid JSON:
{
  "summary": "2-3 sentence overview",
  "painPoints": [
    { "text": "potential pain point", "confidence": "Verified|Likely|Inferred|Unknown" }
  ],
  "automationOpportunities": [
    { "text": "automation opportunity", "confidence": "Verified|Likely|Inferred|Unknown" }
  ],
  "recommendation": "Why BRO recommends this lead as a sales opportunity",
  "recommendedApproach": "Suggested outreach approach"
}`;

export async function enrichLead(
  lead: RawLead | DedupedLead,
  preferredProviderId?: string,
): Promise<LeadEnrichment> {
  const context = buildLeadContext(lead);

  const userPrompt = `Analyze this business lead and generate an enriched profile:\n\n${context}`;

  try {
    const result = await salesCompletion(
      {
        messages: [
          { role: 'system', content: ENRICHMENT_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.2,
        maxTokens: 1000,
      },
      preferredProviderId,
    );

    const parsed = parseStructuredJson<LeadEnrichment>(result.content);
    if (parsed) {
      return parsed;
    }
  } catch {
    // Fall through to basic enrichment
  }

  return basicEnrichment(lead);
}

function buildLeadContext(lead: RawLead | DedupedLead): string {
  const parts: string[] = [];
  parts.push(`Company: ${lead.companyName}`);
  if (lead.industry) parts.push(`Industry: ${lead.industry}`);
  if (lead.companyDescription) parts.push(`Description: ${lead.companyDescription}`);
  if (lead.city || lead.state || lead.country) {
    parts.push(`Location: [city=${lead.city}, state=${lead.state}, country=${lead.country}]`);
  }
  if (lead.website) parts.push(`Website: ${lead.website}`);
  if (lead.phone) parts.push(`Phone: ${lead.phone}`);
  if (lead.rating) parts.push(`Google Rating: ${lead.rating}`);
  if (lead.reviewCount) parts.push(`Review Count: ${lead.reviewCount}`);
  if ('sources' in lead) parts.push(`Sources found: ${(lead as DedupedLead).sources.join(', ')}`);

  const hiring = ('hiringSignals' in lead ? (lead as DedupedLead).hiringSignals : []) ?? [];
  if (hiring.length) parts.push(`Hiring signals: ${hiring.join('; ')}`);

  const intent = ('intentSignals' in lead ? (lead as DedupedLead).intentSignals : []) ?? [];
  if (intent.length) parts.push(`Intent signals: ${intent.join('; ')}`);

  return parts.join('\n');
}

function basicEnrichment(lead: RawLead): LeadEnrichment {
  const summary = `${lead.companyName}${
    lead.industry ? ` is a ${lead.industry.toLowerCase()} business` : ''
  }${lead.city ? ` based in ${lead.city}${lead.state ? `, ${lead.state}` : ''}` : ''}.`;
  const painPoints: Array<{
    text: string;
    confidence: 'Verified' | 'Likely' | 'Inferred' | 'Unknown';
  }> = lead.painPoints?.map((p) => ({ text: p, confidence: 'Inferred' as const })) ?? [];
  const autoOpps: Array<{
    text: string;
    confidence: 'Verified' | 'Likely' | 'Inferred' | 'Unknown';
  }> =
    lead.automationOpportunities?.map((a) => ({ text: a, confidence: 'Inferred' as const })) ?? [];

  if (!painPoints.length) {
    painPoints.push({ text: 'No explicit pain points identified', confidence: 'Unknown' });
  }
  if (!autoOpps.length) {
    autoOpps.push({ text: 'AI receptionist', confidence: 'Inferred' });
    autoOpps.push({ text: 'Lead follow-up automation', confidence: 'Inferred' });
  }

  return {
    summary,
    painPoints,
    automationOpportunities: autoOpps,
    recommendation: `Lead found via ${lead.source}. Further research recommended.`,
    recommendedApproach: 'Research the company website and social presence before outreach.',
  };
}

/**
 * AI-assisted lead scoring from 0–100.
 */
export function scoreLead(lead: RawLead | DedupedLead): LeadScoreBreakdown {
  let total = 0;
  const reasons: string[] = [];

  // Industry relevance (implicit scoring based on signals)
  if (lead.industry) {
    total += 10;
    reasons.push(`Industry present: ${lead.industry}`);
  }

  // Location
  if (lead.city || lead.state || lead.country) {
    total += 10;
    reasons.push('Location identified');
  }

  // Multi-source confidence
  if ('sources' in lead) {
    const sources = (lead as DedupedLead).sources;
    if (sources.length >= 4) {
      total += 20;
      reasons.push(`Found across ${sources.length} sources — high confidence`);
    } else if (sources.length >= 3) {
      total += 15;
      reasons.push(`Found across ${sources.length} sources`);
    } else if (sources.length >= 2) {
      total += 10;
      reasons.push(`Found across ${sources.length} sources`);
    }
  }

  // Google Maps signals
  if (lead.rating && lead.rating >= 4.0) {
    total += 5;
    reasons.push(`High rating: ${lead.rating}/5`);
  }
  if (lead.reviewCount && lead.reviewCount >= 10) {
    total += 5;
    reasons.push(`Active review profile: ${lead.reviewCount} reviews`);
  }
  if (lead.googleMapsUrl) {
    total += 5;
    reasons.push('Google Maps presence confirmed');
  }

  // Contact availability
  if (lead.website) {
    total += 5;
    reasons.push('Website available');
  }
  if (lead.phone) {
    total += 5;
    reasons.push('Phone number available');
  }
  if (lead.email) {
    total += 5;
    reasons.push('Email available');
  }

  // Hiring signals
  if (lead.hiringSignals && lead.hiringSignals.length > 0) {
    total += 15;
    reasons.push(`Hiring activity detected: ${lead.hiringSignals[0]}`);
  }

  // Intent signals
  if (lead.intentSignals && lead.intentSignals.length > 0) {
    total += 10;
    reasons.push(`Intent signals detected: ${lead.intentSignals.slice(0, 2).join('; ')}`);
  }

  // Automation opportunities
  if (lead.automationOpportunities && lead.automationOpportunities.length > 0) {
    total += 10;
    reasons.push(`${lead.automationOpportunities.length} automation opportunities identified`);
  }

  // Pain points
  if (lead.painPoints && lead.painPoints.length > 0) {
    total += 5;
    reasons.push('Pain points identified');
  }

  // LinkedIn presence bonus
  if (lead.linkedinUrl) {
    total += 5;
    reasons.push('LinkedIn presence');
  }

  return { total: Math.min(total, 100), reasons };
}

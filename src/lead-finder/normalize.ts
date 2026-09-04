import type { DedupedLead, LeadSource, NormalizedLead, RawLead } from './types.js';

function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(
      /\b(inc|llc|ltd|corp|co|company|group|enterprises|associates|services|solutions)\b\.?/g,
      '',
    )
    .replace(/\s+/g, ' ')
    .trim();
}

function extractDomain(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return undefined;
  }
}

function normalizePhone(phone: string | undefined): string | undefined {
  if (!phone) return undefined;
  return phone.replace(/[^0-9+]/g, '');
}

export function normalizeLead(lead: RawLead): NormalizedLead {
  return {
    ...lead,
    normalizedCompanyName: normalizeCompanyName(lead.companyName),
    domain: extractDomain(lead.website) ?? extractDomain(lead.sourceUrl),
  };
}

function buildDeduplicationKey(lead: NormalizedLead): string {
  // Priority 1: Google Place ID
  if (lead.sourceId && lead.source === 'google_maps' && lead.sourceId.startsWith('Ch')) {
    return `place:${lead.sourceId}`;
  }

  // Priority 2: Domain (most reliable cross-source match)
  if (lead.domain) {
    return `domain:${lead.domain}`;
  }

  // Priority 3: Phone number
  const phone = normalizePhone(lead.phone);
  if (phone && phone.length >= 8) {
    return `phone:${phone}`;
  }

  // Priority 4: Normalized company name + city
  const city = lead.city?.toLowerCase().trim() ?? '';
  const state = lead.state?.toLowerCase().trim() ?? '';
  const location = city || state;
  if (lead.normalizedCompanyName && location) {
    return `name:${lead.normalizedCompanyName}|loc:${location}`;
  }

  // Priority 5: Normalized company name alone
  if (lead.normalizedCompanyName.length > 3) {
    return `name:${lead.normalizedCompanyName}`;
  }

  // Priority 6: Source-specific URL
  if (lead.sourceUrl) {
    return `url:${lead.sourceUrl}`;
  }

  // Fallback: company name + source
  return `fallback:${lead.normalizedCompanyName}|${lead.source}`;
}

function mergeLeadData(existing: DedupedLead, incoming: RawLead): DedupedLead {
  return {
    ...existing,
    website: existing.website ?? incoming.website,
    email: existing.email ?? incoming.email,
    phone: existing.phone ?? incoming.phone,
    address: existing.address ?? incoming.address,
    city: existing.city ?? incoming.city,
    state: existing.state ?? incoming.state,
    country: existing.country ?? incoming.country,
    employeeCount: existing.employeeCount ?? incoming.employeeCount,
    rating: existing.rating ?? incoming.rating,
    reviewCount: existing.reviewCount ?? incoming.reviewCount,
    linkedinUrl: existing.linkedinUrl ?? incoming.linkedinUrl,
    googleMapsUrl: existing.googleMapsUrl ?? incoming.googleMapsUrl,
    redditUrl: existing.redditUrl ?? incoming.redditUrl,
    indeedUrl: existing.indeedUrl ?? incoming.indeedUrl,
    industry: existing.industry ?? incoming.industry,
    companyDescription: existing.companyDescription ?? incoming.companyDescription,
    sources: [...new Set([...existing.sources, incoming.source])],
    sourceUrls: {
      ...existing.sourceUrls,
      ...(incoming.sourceUrl ? { [incoming.source]: incoming.sourceUrl } : {}),
    },
    hiringSignals: [
      ...new Set([...(existing.hiringSignals ?? []), ...(incoming.hiringSignals ?? [])]),
    ],
    intentSignals: [
      ...new Set([...(existing.intentSignals ?? []), ...(incoming.intentSignals ?? [])]),
    ],
    painPoints: [...new Set([...(existing.painPoints ?? []), ...(incoming.painPoints ?? [])])],
    automationOpportunities: [
      ...new Set([
        ...(existing.automationOpportunities ?? []),
        ...(incoming.automationOpportunities ?? []),
      ]),
    ],
    sourceData: {
      ...(existing.sourceData ?? {}),
      ...(incoming.sourceData ?? {}),
    },
  };
}

/**
 * Normalizes and deduplicates a list of raw leads.
 * Multiple leads from different sources that represent the same company
 * are merged into a single lead with combined source attribution.
 */
export function deduplicateLeads(leads: RawLead[]): DedupedLead[] {
  const normalized = leads.map(normalizeLead);
  const deduplicationMap = new Map<string, DedupedLead>();

  for (const lead of normalized) {
    const key = buildDeduplicationKey(lead);
    const existing = deduplicationMap.get(key);

    if (existing) {
      deduplicationMap.set(key, mergeLeadData(existing, lead));
    } else {
      const sources: LeadSource[] = [lead.source];
      const sourceUrls: Record<string, string> = lead.sourceUrl
        ? { [lead.source]: lead.sourceUrl }
        : {};

      deduplicationMap.set(key, {
        ...lead,
        sources,
        sourceUrls,
        confidence: 1.0 / sources.length,
      });
    }
  }

  // Update confidence scores based on how many sources each lead was found in
  const deduped = [...deduplicationMap.values()];
  for (const lead of deduped) {
    const sourceCount = lead.sources.length;
    // 1 source = 0.3, 2 sources = 0.6, 3+ sources = 0.85, 4+ = 0.95
    if (sourceCount >= 4) {
      lead.confidence = 0.95;
    } else if (sourceCount >= 3) {
      lead.confidence = 0.85;
    } else if (sourceCount >= 2) {
      lead.confidence = 0.6;
    } else {
      lead.confidence = 0.3;
    }
  }

  return deduped;
}

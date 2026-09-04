import { salesCompletion, parseStructuredJson } from '../sales/llm.js';
import type { LeadSearchParams, LeadSource } from './types.js';

const QUERY_PARSER_SYSTEM_PROMPT = `You are BRO's search parameter parser. Convert a natural language request into structured search parameters for lead discovery.

You must analyze the user's request and extract:
- query: the main search terms
- industry: business category/industry if mentioned
- location: full location string if mentioned
- country: country if mentioned
- city: city if mentioned
- state: state/region if mentioned
- keywords: relevant search keywords
- hiringSignals: true if they want companies that are hiring
- intentSignals: true if they want companies showing buying intent

Available sources: google_maps, linkedin, indeed, reddit, web

If the user doesn't specify sources, include all available ones.

Respond with ONLY valid JSON matching this schema:
{
  "query": "main search query",
  "industry": "industry or null",
  "location": "full location or null",
  "country": "country or null",
  "city": "city or null",
  "state": "state or null",
  "sources": ["google_maps", "linkedin", "indeed", "reddit", "web"],
  "keywords": ["keyword1", "keyword2"],
  "hiringSignals": false,
  "intentSignals": false,
  "limit": 20
}`;

type ParsedQuery = {
  query?: string;
  industry?: string;
  location?: string;
  country?: string;
  city?: string;
  state?: string;
  sources?: LeadSource[];
  keywords?: string[];
  hiringSignals?: boolean;
  intentSignals?: boolean;
  limit?: number;
};

/**
 * Converts a natural language user query into structured LeadSearchParams.
 * If AI is not configured, falls back to simple keyword extraction.
 */
export async function parseSearchQuery(
  rawQuery: string,
  preferredProviderId?: string,
): Promise<LeadSearchParams> {
  // Try AI parsing first
  try {
    const result = await salesCompletion(
      {
        messages: [
          { role: 'system', content: QUERY_PARSER_SYSTEM_PROMPT },
          { role: 'user', content: rawQuery },
        ],
        temperature: 0.1,
        maxTokens: 500,
      },
      preferredProviderId,
    );

    const parsed = parseStructuredJson<ParsedQuery>(result.content);
    if (parsed && (parsed.query || parsed.industry)) {
      return {
        query: parsed.query ?? rawQuery,
        industry: parsed.industry ?? undefined,
        location: parsed.location ?? undefined,
        country: parsed.country ?? undefined,
        city: parsed.city ?? undefined,
        state: parsed.state ?? undefined,
        sources: (parsed.sources as LeadSource[]) ?? undefined,
        keywords: parsed.keywords?.length ? parsed.keywords : undefined,
        hiringSignals: parsed.hiringSignals,
        intentSignals: parsed.intentSignals,
        limit: parsed.limit ?? 20,
      };
    }
  } catch {
    // Fall through to simple parsing
  }

  // Simple keyword extraction fallback
  return simpleParseQuery(rawQuery);
}

function simpleParseQuery(rawQuery: string): LeadSearchParams {
  const query = rawQuery.trim();
  const lowerQuery = query.toLowerCase();

  // Detect location patterns like "in Texas", "in New York"
  const locationMatch = /\b(?:in|near|at)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/.exec(query);
  const cityMatch =
    /\b(?:in|near)\s+(New York|Los Angeles|Chicago|Houston|Phoenix|London|Tokyo|Paris|Berlin|Toronto|Sydney|Nairobi|Lagos|Miami|Seattle|Denver|Austin|Boston|Atlanta|Dallas)/i.exec(
      query,
    );
  const stateMatch =
    /\b(?:in|near)\s+(Texas|California|Florida|New York|Illinois|Pennsylvania|Ohio|Georgia|North Carolina|Michigan|New Jersey|Virginia|Washington|Arizona|Massachusetts|Tennessee|Indiana|Missouri|Maryland|Wisconsin|Colorado|Minnesota|South Carolina|Alabama|Louisiana|Kentucky|Oregon|Oklahoma|Connecticut|Utah|Iowa|Nevada|Arkansas|Mississippi|Kansas|New Mexico|Nebraska|Idaho|West Virginia|Hawaii|New Hampshire|Maine|Montana|Rhode Island|Delaware|South Dakota|North Dakota|Alaska|Vermont|Wyoming|UK|England)/i.exec(
      query,
    );
  const countryMatch =
    /\b(?:in|near|at)\s+(USA|United States|Canada|UK|United Kingdom|Germany|France|Japan|China|India|Australia|Kenya|Nigeria|South Africa|Brazil|Mexico|Spain|Italy|Netherlands|Sweden|Norway|Denmark|Singapore|Ireland|New Zealand)/i.exec(
      query,
    );

  // Detect industry
  const industryKeywords = [
    'dental',
    'restaurant',
    'law firm',
    'real estate',
    'gym',
    'salon',
    'medical',
    'healthcare',
    'fitness',
    'clinic',
    'pharmacy',
    'roofing',
    'plumbing',
    'electric',
    'auto',
    'auto repair',
    'car dealership',
    'SaaS',
    'startup',
    'agency',
    'consulting',
    'marketing',
  ];
  const detectedIndustry = industryKeywords.find((kw) => lowerQuery.includes(kw.toLowerCase()));

  // Detect hiring signals
  const hiringSignals = /\b(hir(?:ing|e)|recruit|job opening|vacancy|staffing)\b/i.test(query);

  return {
    query: detectedIndustry ? detectedIndustry : query,
    industry: detectedIndustry,
    city: cityMatch?.[1],
    state: stateMatch?.[1],
    country: countryMatch?.[1],
    location: locationMatch?.[1],
    sources: ['google_maps', 'linkedin', 'indeed', 'reddit', 'web'],
    hiringSignals,
    limit: 20,
  };
}

import { fetchJson, fetchText } from '../lib/http.js';
import { salesCompletion, parseStructuredJson } from './llm.js';
import { salesMethodologyBlock } from './methodology.js';
import type { CompanyResearchResult, ResearchItem } from './types.js';

export type ResearchInput = {
  companyName?: string;
  website?: string;
};

type SearchTopic = { Text?: string; FirstURL?: string; Topics?: SearchTopic[] };

type DuckDuckGoResponse = {
  AbstractText?: string;
  AbstractURL?: string;
  RelatedTopics?: SearchTopic[];
};

const MAX_SEARCH_RESULTS = 5;
const REQUEST_TIMEOUT_MS = 8000;
const MAX_SITE_TEXT = 6000;

function collectTopics(topics: SearchTopic[] | undefined, out: string[]): void {
  for (const topic of topics ?? []) {
    if (topic.Topics) {
      collectTopics(topic.Topics, out);
    } else if (topic.Text && topic.FirstURL) {
      out.push(`${topic.Text} (${topic.FirstURL})`);
    }
  }
}

export async function searchCompanyWeb(query: string): Promise<string> {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
  const data = await fetchJson<DuckDuckGoResponse>(url, { timeoutMs: REQUEST_TIMEOUT_MS });
  const lines: string[] = [];
  if (data.AbstractText && data.AbstractURL) {
    lines.push(`${data.AbstractText}\nSource: ${data.AbstractURL}`);
  }
  const topics: string[] = [];
  collectTopics(data.RelatedTopics, topics);
  lines.push(...topics.slice(0, MAX_SEARCH_RESULTS));
  return lines.join('\n').trim();
}

export async function fetchCompanyWebsiteText(website: string): Promise<string> {
  const text = await fetchText(website, { timeoutMs: REQUEST_TIMEOUT_MS });
  const stripped = text
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped.slice(0, MAX_SITE_TEXT);
}

const RESEARCH_SYSTEM_PROMPT = `You are BRO's sales research analyst. Your job is to analyze a company from publicly available information and report ONLY what you can stand behind.

Every finding must carry a confidence level:
- KNOWN: stated by the source or directly observed.
- INFERRED: a reasonable deduction from the source (label it as such).
- ESTIMATED: an approximate value derived from the data.
- UNKNOWN: you do not know; leave it empty or say so.

NEVER fabricate information. If the sources give you nothing, mark the field UNKNOWN rather than guessing. Do not invent revenue figures, client names, headcount, or statistics.

${salesMethodologyBlock()}

Respond with ONLY valid JSON in this exact shape:
{
  "summary": "2-3 sentence overview of what the company does, marked with confidence where relevant",
  "industry": { "confidence": "KNOWN|INFERRED|ESTIMATED|UNKNOWN", "value": "..." },
  "whatTheyDo": { "confidence": "KNOWN|INFERRED|ESTIMATED|UNKNOWN", "value": "..." },
  "productsServices": [{ "confidence": "...", "value": "..." }],
  "targetCustomers": [{ "confidence": "...", "value": "..." }],
  "recentSignals": [{ "confidence": "...", "value": "..." }],
  "painPoints": [{ "confidence": "...", "value": "..." }],
  "automationOpportunities": [{ "confidence": "...", "value": "..." }],
  "websiteMarketingOpportunities": [{ "confidence": "...", "value": "..." }],
  "decisionMakers": [{ "confidence": "...", "value": "name and/or role" }],
  "suggestedService": { "confidence": "...", "value": "the service most likely to help them" },
  "warnings": ["anything in the sources that is unverified and should be checked"]
}`;

function markUnknown(result: CompanyResearchResult): CompanyResearchResult {
  const unknown: ResearchItem = {
    confidence: 'UNKNOWN',
    value: 'No public information available.',
  };
  return {
    summary: 'No public information could be gathered from the available sources.',
    industry: unknown,
    whatTheyDo: unknown,
    productsServices: [unknown],
    targetCustomers: [unknown],
    recentSignals: [unknown],
    painPoints: [unknown],
    automationOpportunities: [unknown],
    websiteMarketingOpportunities: [unknown],
    decisionMakers: [unknown],
    suggestedService: unknown,
    warnings: ['Sources returned no usable information.'],
    ...result,
  };
}

/**
 * Researches a company from its name and/or website. Gathers raw public data
 * via web search (and a website scrape when a URL is provided), then asks the
 * LLM to synthesize it into a structured profile with explicit confidence
 * markers. When AI is not configured, returns the raw findings with cautious
 * KNOWN/UNKNOWN marking only.
 */
export async function researchCompany(
  input: ResearchInput,
  preferredProviderId?: string,
): Promise<CompanyResearchResult> {
  const query = input.companyName ?? input.website ?? '';
  const sources: string[] = [];

  if (query) {
    try {
      const search = await searchCompanyWeb(query);
      if (search) {
        sources.push(`Search results for "${query}":\n${search}`);
      }
    } catch (error) {
      sources.push(`Search failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (input.website) {
    try {
      const text = await fetchCompanyWebsiteText(input.website);
      if (text) {
        sources.push(`Website content from ${input.website}:\n${text}`);
      }
    } catch (error) {
      sources.push(
        `Website fetch failed for ${input.website}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const sourceText = sources.join('\n\n').trim();
  if (!sourceText) {
    return markUnknown({});
  }

  const userPrompt = `Company name: ${input.companyName ?? 'unknown'}\nWebsite: ${input.website ?? 'unknown'}\n\nResearch notes:\n${sourceText}`;

  let result: { content: string };
  try {
    result = await salesCompletion(
      {
        messages: [
          { role: 'system', content: RESEARCH_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.2,
        maxTokens: 1200,
      },
      preferredProviderId,
    );
  } catch {
    return rawResearchFallback(input, sourceText);
  }

  const parsed = parseStructuredJson<CompanyResearchResult>(result.content);
  if (parsed) {
    return {
      ...parsed,
      companyName: input.companyName,
      website: input.website,
      ...(parsed.industry?.confidence === 'UNKNOWN' && !parsed.summary
        ? { summary: 'No reliable public information could be gathered.' }
        : {}),
    };
  }

  // AI unavailable or returned unparseable JSON: surface raw sources with
  // conservative confidence markers so nothing is fabricated.
  return rawResearchFallback(input, sourceText);
}

function rawResearchFallback(input: ResearchInput, sourceText: string): CompanyResearchResult {
  return {
    companyName: input.companyName,
    website: input.website,
    summary: `Raw research gathered from public sources. AI synthesis was unavailable, so findings below are unverified:`,
    whatTheyDo: { confidence: 'KNOWN', value: sourceText.slice(0, 2000) },
    industry: { confidence: 'UNKNOWN', value: 'Not determined (AI synthesis unavailable).' },
    productsServices: [],
    targetCustomers: [],
    recentSignals: [],
    painPoints: [],
    automationOpportunities: [],
    websiteMarketingOpportunities: [],
    decisionMakers: [],
    suggestedService: {
      confidence: 'UNKNOWN',
      value: 'Review the raw findings above to recommend a service.',
    },
    warnings: ['AI synthesis was unavailable; these are raw, unverified search results.'],
  };
}

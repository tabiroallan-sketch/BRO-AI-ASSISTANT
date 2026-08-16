import { fetchJson } from '../../lib/http.js';
import type {
  OpportunityCandidate,
  OpportunitySourceAdapter,
  SourceSearchResult,
} from './types.js';

const REQUEST_TIMEOUT_MS = 8000;
const MAX_RESULTS = 8;

type DdgTopic = { Text?: string; FirstURL?: string; Topics?: DdgTopic[] };
type DdgResponse = {
  AbstractText?: string;
  AbstractURL?: string;
  Heading?: string;
  RelatedTopics?: DdgTopic[];
};

function collectTopics(topics: DdgTopic[] | undefined, out: DdgTopic[]): void {
  for (const topic of topics ?? []) {
    if (topic.Topics) {
      collectTopics(topic.Topics, out);
    } else if (topic.Text && topic.FirstURL) {
      out.push(topic);
    }
  }
}

/**
 * Searches the public web for opportunities. Uses the DuckDuckGo instant-answer
 * API (no account required, public endpoint) and returns each hit as a raw
 * LOW-reliability candidate. Results are unverified; the user reviews before
 * saving. Never fabricates content — only what the search engine returns.
 */
export const webSearchAdapter: OpportunitySourceAdapter = {
  id: 'web-search',
  label: 'Web search',
  supportsSearch: true,
  supportsFetchUrl: false,
  supportsCompanyWebsite: false,

  async search(query: string): Promise<SourceSearchResult> {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    let data: DdgResponse;
    try {
      data = await fetchJson<DdgResponse>(url, { timeoutMs: REQUEST_TIMEOUT_MS });
    } catch (error) {
      return {
        candidates: [],
        errors: [{ message: error instanceof Error ? error.message : String(error) }],
      };
    }

    const rawTopics: DdgTopic[] = [];
    collectTopics(data.RelatedTopics, rawTopics);

    const candidates: OpportunityCandidate[] = [];
    if (data.AbstractText && data.AbstractURL) {
      candidates.push({
        title: data.Heading ?? 'Web result',
        description: data.AbstractText.slice(0, 2000),
        source: 'web-search',
        sourceReliability: 'LOW',
        sourceUrl: data.AbstractURL,
        rawContent: data.AbstractText.slice(0, 6000),
      });
    }
    for (const topic of rawTopics.slice(0, MAX_RESULTS)) {
      if (!topic.Text || !topic.FirstURL) {
        continue;
      }
      candidates.push({
        title: topic.Text.split(' - ')[0]?.trim() ?? topic.Text.slice(0, 120),
        description: topic.Text.slice(0, 2000),
        source: 'web-search',
        sourceReliability: 'LOW',
        sourceUrl: topic.FirstURL,
        rawContent: topic.Text.slice(0, 6000),
      });
    }
    return { candidates, errors: [] };
  },

  async fetchUrl(): Promise<OpportunityCandidate | null> {
    return null;
  },

  async fetchCompanyWebsite(): Promise<SourceSearchResult> {
    return { candidates: [], errors: [] };
  },
};

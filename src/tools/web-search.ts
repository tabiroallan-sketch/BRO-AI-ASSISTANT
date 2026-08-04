import type { Tool } from './types.js';
import { fetchJson } from '../lib/http.js';

type DuckDuckGoResponse = {
  AbstractText?: string;
  AbstractURL?: string;
  RelatedTopics?: Array<{
    Text?: string;
    FirstURL?: string;
    Topics?: Array<{ Text?: string; FirstURL?: string }>;
  }>;
};

type WikipediaResponse = {
  query?: {
    search?: Array<{ title: string; snippet: string }>;
  };
};

const MAX_RESULTS = 5;
const REQUEST_TIMEOUT_MS = 8000;

function stripHtml(text: string): string {
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

async function duckDuckGoSearch(query: string): Promise<string> {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
  const data = await fetchJson<DuckDuckGoResponse>(url, { timeoutMs: REQUEST_TIMEOUT_MS });
  const lines: string[] = [];
  if (data.AbstractText && data.AbstractURL) {
    lines.push(`${data.AbstractText}\nSource: ${data.AbstractURL}`);
  }
  const topics: Array<{ text: string; url: string }> = [];
  const collect = (items: DuckDuckGoResponse['RelatedTopics'] | undefined): void => {
    for (const item of items ?? []) {
      if (item.Topics) {
        collect(item.Topics);
      } else if (item.Text && item.FirstURL) {
        topics.push({ text: item.Text, url: item.FirstURL });
      }
    }
  };
  collect(data.RelatedTopics);
  lines.push(...topics.slice(0, MAX_RESULTS).map((t) => `${t.text} (${t.url})`));
  return lines.join('\n');
}

async function wikipediaSearch(query: string): Promise<string> {
  const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=${MAX_RESULTS}&format=json&origin=*`;
  const data = await fetchJson<WikipediaResponse>(url, { timeoutMs: REQUEST_TIMEOUT_MS });
  const results = data.query?.search ?? [];
  if (results.length === 0) {
    return 'No results found.';
  }
  return results
    .map((result) => {
      const slug = result.title.replace(/ /g, '_');
      return `${stripHtml(result.snippet)}\n  Source: https://en.wikipedia.org/wiki/${encodeURIComponent(slug)}`;
    })
    .join('\n');
}

export const webSearchTool: Tool = {
  name: 'web_search',
  description:
    'Search the web for current information about a topic. Returns concise search results with snippets and source URLs. Use this for questions about current events, facts, people, places, or anything where up-to-date information is needed.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search query, e.g. "latest AI news 2026".',
      },
    },
    required: ['query'],
  },
  async execute(args) {
    const query = typeof args.query === 'string' ? args.query.trim() : '';
    if (!query) {
      throw new Error('Missing "query" argument');
    }
    try {
      const ddg = await duckDuckGoSearch(query);
      if (ddg.trim()) {
        return ddg.trim();
      }
    } catch {
      // fall back to Wikipedia
    }
    try {
      return await wikipediaSearch(query);
    } catch (error) {
      return `Web search failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
};

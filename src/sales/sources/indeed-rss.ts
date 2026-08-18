import type {
  OpportunityCandidate,
  OpportunitySourceAdapter,
  SourceSearchResult,
} from './types.js';

const REQUEST_TIMEOUT_MS = 10000;
const MAX_RESULTS = 10;
const INDEED_RSS_BASE = 'https://www.indeed.com/rss';

type RssItem = {
  title?: string;
  link?: string;
  description?: string;
  pubDate?: string;
};

function parseRssItems(xml: string): RssItem[] {
  const items: RssItem[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match: RegExpExecArray | null;

  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1] ?? '';
    const title = extractTag(block, 'title');
    const link = extractTag(block, 'link');
    const description = extractTag(block, 'description');
    const pubDate = extractTag(block, 'pubDate');

    if (title && link) {
      items.push({ title, link, description: description ?? '', pubDate: pubDate ?? '' });
    }
  }
  return items;
}

function extractTag(block: string, tag: string): string | null {
  const regex = new RegExp(
    `<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tag}>|<${tag}[^>]*>([\\s\\S]*?)</${tag}>`,
  );
  const match = regex.exec(block);
  if (!match) {
    return null;
  }
  const raw = (match[1] ?? match[2] ?? '').trim();
  return decodeHtmlEntities(raw);
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'");
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseIndeedTitle(rawTitle: string): {
  title: string;
  company?: string;
  location?: string;
} {
  // Indeed titles often follow: "Job Title - Company - Location"
  const parts = rawTitle.split(' - ').map((p) => p.trim());
  if (parts.length >= 3) {
    return { title: parts[0] ?? rawTitle, company: parts[1], location: parts.slice(2).join(', ') };
  }
  if (parts.length === 2) {
    return { title: parts[0] ?? rawTitle, company: parts[1] };
  }
  return { title: rawTitle };
}

function buildCandidate(item: RssItem): OpportunityCandidate {
  const parsed = parseIndeedTitle(item.title ?? 'Untitled');
  const description = stripHtml(item.description ?? '');

  return {
    title: parsed.title,
    description: description.slice(0, 4000),
    company: parsed.company,
    source: 'indeed-rss',
    sourceReliability: 'MEDIUM',
    sourceUrl: item.link ?? undefined,
    location: parsed.location,
    postedAt: item.pubDate || undefined,
    rawContent: description.slice(0, 6000),
  };
}

/**
 * Searches for jobs via Indeed's public RSS feed. No API key required.
 * RSS feeds provide limited metadata but are reliable and zero-cost.
 * Format: https://www.indeed.com/rss?q=QUERY&l=LOCATION&sort=date
 */
export const indeedRssAdapter: OpportunitySourceAdapter = {
  id: 'indeed-rss',
  label: 'Indeed RSS',
  supportsSearch: true,
  supportsFetchUrl: false,
  supportsCompanyWebsite: false,

  async search(query: string): Promise<SourceSearchResult> {
    const url = `${INDEED_RSS_BASE}?q=${encodeURIComponent(query)}&sort=date&limit=${MAX_RESULTS}`;
    let xml: string;
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: { 'User-Agent': 'BRO-Sales/1.0 (compatible; RSS reader)' },
      });
      if (!response.ok) {
        return {
          candidates: [],
          errors: [{ message: `Indeed RSS returned HTTP ${response.status}` }],
        };
      }
      xml = await response.text();
    } catch (error) {
      return {
        candidates: [],
        errors: [{ message: error instanceof Error ? error.message : String(error) }],
      };
    }

    const items = parseRssItems(xml);
    const candidates: OpportunityCandidate[] = items.slice(0, MAX_RESULTS).map(buildCandidate);

    return { candidates, errors: [] };
  },

  async fetchUrl(): Promise<OpportunityCandidate | null> {
    return null;
  },

  async fetchCompanyWebsite(): Promise<SourceSearchResult> {
    return { candidates: [], errors: [] };
  },
};

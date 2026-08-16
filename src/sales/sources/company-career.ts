import { assertPublicHttpUrl, fetchText } from '../../lib/http.js';
import type {
  OpportunityCandidate,
  OpportunitySourceAdapter,
  SourceSearchResult,
} from './types.js';

const REQUEST_TIMEOUT_MS = 8000;
const MAX_CAREERS = 12;
const MAX_PAGE_TEXT = 12_000;

const CAREER_HINTS = [
  '/careers',
  '/jobs',
  '/career',
  '/join-us',
  '/about/careers',
  '/company/careers',
  '/en/careers',
  '/careers/',
];

const JOB_PATHS = [
  '/jobs',
  '/careers',
  '/job',
  '/position',
  '/opening',
  '/openings',
  '/vacancy',
  '/vacancies',
  '/roles',
  '/join-us',
];

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function absoluteUrl(base: string, href: string): string {
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}

function looksLikeJobUrl(url: string): boolean {
  const path = new URL(url).pathname.toLowerCase();
  return JOB_PATHS.some((part) => path.includes(part));
}

function extractJobAnchors(html: string, base: string): Array<{ url: string; text: string }> {
  const anchors: Array<{ url: string; text: string }> = [];
  const hrefRe = /<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = hrefRe.exec(html)) !== null) {
    const rawHref = match[1];
    if (
      !rawHref ||
      rawHref.startsWith('#') ||
      rawHref.startsWith('javascript:') ||
      rawHref.startsWith('mailto:')
    ) {
      continue;
    }
    const url = absoluteUrl(base, rawHref);
    const text = stripHtml(match[2] ?? '').trim();
    if (looksLikeJobUrl(url) && text.length >= 2 && text.length <= 200) {
      anchors.push({ url, text });
    }
  }
  // De-dupe by URL, keep the first (often the most descriptive) text.
  const seen = new Set<string>();
  const unique: Array<{ url: string; text: string }> = [];
  for (const anchor of anchors) {
    if (!seen.has(anchor.url)) {
      seen.add(anchor.url);
      unique.push(anchor);
    }
  }
  return unique;
}

/**
 * Fetches a company's public careers page and extracts job/role links as
 * LOW-reliability candidates. Works on publicly accessible pages only; it does
 * not bypass logins, CAPTCHAs, or anti-bot measures. If no careers page is
 * reachable, returns an empty result with a helpful error message.
 */
export const companyCareerAdapter: OpportunitySourceAdapter = {
  id: 'company-career',
  label: 'Company careers',
  supportsSearch: false,
  supportsFetchUrl: true,
  supportsCompanyWebsite: true,

  async search(): Promise<SourceSearchResult> {
    return { candidates: [], errors: [] };
  },

  async fetchUrl(url: string): Promise<OpportunityCandidate | null> {
    try {
      const parsed = await assertPublicHttpUrl(url, 'Opportunity URL');
      const html = await fetchText(parsed.toString(), { timeoutMs: REQUEST_TIMEOUT_MS });
      const text = stripHtml(html);
      const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
      return {
        title:
          (title ? stripHtml(title).slice(0, 200) : 'Company careers').trim() || 'Company careers',
        description: text.slice(0, 2000),
        companyWebsite: parsed.origin,
        source: 'company-career',
        sourceReliability: 'MEDIUM',
        sourceUrl: parsed.toString(),
        rawContent: text.slice(0, MAX_PAGE_TEXT),
      };
    } catch {
      return null;
    }
  },

  async fetchCompanyWebsite(website: string): Promise<SourceSearchResult> {
    let parsed: URL;
    try {
      parsed = await assertPublicHttpUrl(website, 'Company website');
    } catch (error) {
      return {
        candidates: [],
        errors: [{ message: error instanceof Error ? error.message : String(error) }],
      };
    }

    const base = parsed.origin;
    const candidates: OpportunityCandidate[] = [];
    const errors: Array<{ message: string }> = [];

    for (const hint of CAREER_HINTS) {
      const url = `${base}${hint}`;
      try {
        const html = await fetchText(url, { timeoutMs: REQUEST_TIMEOUT_MS });
        const anchors = extractJobAnchors(html, base);
        for (const anchor of anchors.slice(0, MAX_CAREERS)) {
          candidates.push({
            title: anchor.text.slice(0, 200),
            companyWebsite: base,
            source: 'company-career',
            sourceReliability: 'LOW',
            sourceUrl: anchor.url,
            rawContent: `Source: ${url}`,
          });
        }
        if (anchors.length > 0) {
          break; // The first reachable careers page with roles is enough.
        }
      } catch {
        errors.push({ message: `Could not reach ${url}` });
      }
    }

    if (candidates.length === 0 && errors.length === 0) {
      errors.push({ message: `No careers page found at ${base}.` });
    }
    return { candidates, errors };
  },
};

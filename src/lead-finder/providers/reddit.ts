import { config } from '../../config/index.js';
import { getLeadCredential } from '../credentials.js';
import type { LeadProvider, LeadSearchParams, LeadSource, RawLead } from '../types.js';

const REDDIT_SEARCH_URL = 'https://www.reddit.com/search.json';
const REDDIT_OAUTH_URL = 'https://oauth.reddit.com';
const REQUEST_TIMEOUT_MS = 10000;

type RedditPost = {
  id?: string;
  name?: string;
  title?: string;
  selftext?: string;
  url?: string;
  permalink?: string;
  author?: string;
  subreddit?: string;
  created_utc?: number;
  num_comments?: number;
  score?: number;
  link_flair_text?: string;
  domain?: string;
  is_self?: boolean;
  thumbnail?: string;
};

type RedditSearchResponse = {
  data?: {
    children?: Array<{
      kind?: string;
      data?: RedditPost;
    }>;
    after?: string;
  };
  error?: number;
  message?: string;
};

type RedditTokenResponse = {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  error?: string;
};

let cachedBearerToken: string | null = null;
let bearerTokenExpiry = 0;

async function getBearerToken(): Promise<string | null> {
  if (cachedBearerToken && Date.now() < bearerTokenExpiry) {
    return cachedBearerToken;
  }

  const runtimeClientId = await getLeadCredential('reddit', 'clientId');
  const runtimeClientSecret = await getLeadCredential('reddit', 'clientSecret');
  const clientId = runtimeClientId ?? config.redditClientId;
  const clientSecret = runtimeClientSecret ?? config.redditClientSecret;

  if (!clientId || !clientSecret) {
    return null;
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  try {
    const response = await fetch('https://www.reddit.com/api/v1/access_token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': config.redditUserAgent,
      },
      body: 'grant_type=https://oauth.reddit.com/grants/installed_client&device_id=DO_NOT_TRACK_THIS_DEVICE',
      signal: AbortSignal.timeout(8000),
    });

    const data = (await response.json()) as RedditTokenResponse;
    if (data.access_token) {
      cachedBearerToken = data.access_token;
      bearerTokenExpiry = Date.now() + (data.expires_in ?? 3600) * 1000 - 60000;
      return data.access_token;
    }
  } catch {
    // Fall through to unauthenticated search
  }
  return null;
}

function normalizeRedditPost(post: RedditPost): RawLead | null {
  const title = post.title?.trim();
  if (!title) return null;

  const permalink = post.permalink;
  const redditUrl = permalink ? `https://www.reddit.com${permalink}` : undefined;

  const selftext = post.selftext ?? '';
  const intentSignals: string[] = [];

  const painPatterns = [
    'looking for',
    'need help',
    'struggling with',
    'problem with',
    'trying to find',
    'searching for',
    'anyone know',
    'recommend',
    'suggestion',
    'advice',
    'automat',
    'CRM',
    'customer support',
    'appointment',
    'lead',
    'overwhelmed',
    'inefficient',
    'manual',
    'time-consuming',
    'repetitive',
  ];

  const combined = `${title} ${selftext}`.toLowerCase();
  for (const pattern of painPatterns) {
    if (combined.includes(pattern.toLowerCase())) {
      intentSignals.push(pattern);
    }
  }

  return {
    companyName: post.author ?? 'Reddit User',
    companyDescription: title.slice(0, 200),
    industry: post.subreddit,
    website: undefined,
    redditUrl,
    source: 'reddit',
    sourceId: post.name ?? post.id,
    sourceUrl: redditUrl,
    sourceData: {
      subreddit: post.subreddit,
      author: post.author,
      score: post.score,
      numComments: post.num_comments,
      domain: post.domain,
      isSelf: post.is_self,
      createdUtc: post.created_utc,
      flair: post.link_flair_text,
      selftext: selftext.slice(0, 2000),
    },
    intentSignals: intentSignals.length > 0 ? intentSignals : undefined,
  };
}

export const redditProvider: LeadProvider = {
  id: 'reddit',
  label: 'Reddit',
  sources: ['reddit'] as LeadSource[],
  supportedParams: ['query', 'industry', 'keywords', 'limit'],

  isConfigured(): boolean {
    return true; // Reddit search works without API keys (rate-limited)
  },

  async search(params: LeadSearchParams): Promise<RawLead[]> {
    const queryParts: string[] = [];
    if (params.query) queryParts.push(params.query);
    if (params.industry) queryParts.push(`subreddit:${params.industry}`);
    if (params.keywords?.length) queryParts.push(params.keywords.join(' '));

    const query = queryParts.join(' ').trim();
    if (!query) return [];

    const limit = Math.min(params.limit ?? 25, 100);

    // Try authenticated search first for higher rate limits
    const token = await getBearerToken();

    let url: string;
    const headers: Record<string, string> = {
      'User-Agent': config.redditUserAgent,
      Accept: 'application/json',
    };

    if (token) {
      url = `${REDDIT_OAUTH_URL}/search?q=${encodeURIComponent(query)}&limit=${limit}&t=month&type=link`;
      headers.Authorization = `Bearer ${token}`;
    } else {
      url = `${REDDIT_SEARCH_URL}?q=${encodeURIComponent(query)}&limit=${limit}&t=month`;
    }

    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`Reddit API returned HTTP ${response.status}`);
    }

    const data = (await response.json()) as RedditSearchResponse;
    if (data.error) {
      throw new Error(`Reddit error: ${data.message ?? 'unknown'}`);
    }

    const results: RawLead[] = [];
    for (const child of data.data?.children ?? []) {
      if (child.data) {
        const lead = normalizeRedditPost(child.data);
        if (lead) results.push(lead);
      }
    }

    return results.slice(0, limit);
  },

  async healthCheck() {
    const start = Date.now();
    try {
      const url = `${REDDIT_SEARCH_URL}?q=test&limit=1`;
      const response = await fetch(url, {
        headers: { 'User-Agent': config.redditUserAgent },
        signal: AbortSignal.timeout(8000),
      });
      return {
        ok: response.ok,
        latencyMs: Date.now() - start,
        message: response.ok ? undefined : `HTTP ${response.status}`,
      };
    } catch {
      return { ok: false, message: 'Reddit unreachable', latencyMs: Date.now() - start };
    }
  },
};

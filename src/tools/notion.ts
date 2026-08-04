import { requireProviderToken } from '../integrations/access.js';
import type { Tool } from './types.js';
import { fetchWithTimeout } from '../lib/http.js';

const NOTION_VERSION = '2022-06-28';

type NotionPage = {
  id?: string;
  last_edited_time?: string;
  properties?: Record<string, unknown>;
  url?: string;
};

function notionHeaders(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    'notion-version': NOTION_VERSION,
    'content-type': 'application/json',
  };
}

function pageTitle(page: NotionPage): string {
  const properties = page.properties ?? {};
  for (const value of Object.values(properties)) {
    const entry = value as { type?: string; title?: { plain_text?: string }[] };
    if (entry?.type === 'title') {
      const text = entry.title ?? [];
      return text.map((t) => t.plain_text ?? '').join('');
    }
  }
  return '(untitled)';
}

export const notionSearchPagesTool: Tool = {
  name: 'notion_search_pages',
  description:
    'Search the user\u2019s Notion workspace for pages and return matching page titles with last edited time.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search text to match against page titles and content.',
      },
      maxResults: {
        type: 'string',
        description: 'Maximum number of pages to return (default 10).',
      },
    },
  },
  async execute(args, context) {
    const token = await requireProviderToken(context.userId, 'notion');
    const query = typeof args.query === 'string' ? args.query.trim() : '';
    const maxResults = typeof args.maxResults === 'string' ? args.maxResults : '10';
    const response = await fetchWithTimeout('https://api.notion.com/v1/search', {
      method: 'POST',
      timeoutMs: 10_000,
      headers: notionHeaders(token),
      body: JSON.stringify({
        ...(query ? { query } : {}),
        filter: { value: 'page', property: 'object' },
        page_size: parseInt(maxResults, 10) || 10,
      }),
    });
    if (!response.ok) {
      throw new Error(`Notion request failed with status ${response.status}`);
    }
    const body = (await response.json()) as { results?: NotionPage[] };
    const pages = body.results ?? [];
    if (pages.length === 0) {
      return 'No pages found.';
    }
    const lines = pages.map(
      (page, index) =>
        `${index + 1}. ${pageTitle(page)} (edited ${page.last_edited_time ?? 'unknown'})`,
    );
    return lines.join('\n');
  },
};

export const notionCreatePageTool: Tool = {
  name: 'notion_create_page',
  description:
    'Create a new page inside an existing page in the user\u2019s Notion workspace. Provide the parent page ID and the new page title.',
  parameters: {
    type: 'object',
    properties: {
      parentId: { type: 'string', description: 'ID of the parent page to create the page inside.' },
      title: { type: 'string', description: 'Title of the new page.' },
    },
    required: ['parentId', 'title'],
  },
  async execute(args, context) {
    const parentId = typeof args.parentId === 'string' ? args.parentId.trim() : '';
    const title = typeof args.title === 'string' ? args.title.trim() : '';
    if (!parentId || !title) {
      throw new Error('Missing "parentId" or "title" argument');
    }
    const token = await requireProviderToken(context.userId, 'notion');
    const response = await fetchWithTimeout('https://api.notion.com/v1/pages', {
      method: 'POST',
      timeoutMs: 10_000,
      headers: notionHeaders(token),
      body: JSON.stringify({
        parent: { type: 'page_id', page_id: parentId },
        properties: {
          title: {
            title: [{ text: { content: title } }],
          },
        },
      }),
    });
    if (!response.ok) {
      throw new Error(`Notion request failed with status ${response.status}`);
    }
    const page = (await response.json()) as NotionPage;
    return `Page created: "${title}" (id: ${page.id ?? 'unknown'})`;
  },
};

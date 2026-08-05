import { requirePermission } from '../integrations/access.js';
import type { Tool } from './types.js';
import { fetchWithTimeout } from '../lib/http.js';

const NOTION_VERSION = '2022-06-28';
const NOTION_API = 'https://api.notion.com/v1';

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

async function notionError(response: Response, fallback: string): Promise<never> {
  let detail: string | null = null;
  try {
    const body = (await response.json()) as { message?: string };
    detail = typeof body.message === 'string' && body.message ? body.message : null;
  } catch {
    // Non-JSON error body; fall through to the status fallback.
  }
  throw new Error(detail ? `Notion error: ${detail}` : fallback);
}

export const notionWorkspaceTool: Tool = {
  name: 'notion_workspace',
  description:
    'Show the Notion workspace this integration is connected to, including the integration name and workspace ID.',
  parameters: {
    type: 'object',
    properties: {},
  },
  async execute(_args, context) {
    const token = await requirePermission(context.userId, 'notion', 'notion.workspace');
    const response = await fetchWithTimeout(`${NOTION_API}/users/me`, {
      method: 'GET',
      timeoutMs: 10_000,
      headers: notionHeaders(token),
    });
    if (!response.ok) {
      await notionError(response, `Notion request failed with status ${response.status}`);
    }
    const body = (await response.json()) as {
      id?: string;
      name?: string;
      type?: string;
      bot?: {
        owner?: { type?: string };
        workspace_id?: string;
        workspace_name?: string | null;
      };
    };
    const workspaceName = body.bot?.workspace_name?.trim() || '(unnamed workspace)';
    const ownerType = body.bot?.owner?.type ?? body.type ?? 'unknown';
    const lines = [
      `Integration: ${body.name ?? '(unnamed integration)'}`,
      `Workspace: ${workspaceName}`,
      `Workspace ID: ${body.bot?.workspace_id ?? 'unknown'}`,
      `Owner type: ${ownerType}`,
    ];
    return lines.join('\n');
  },
};

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
    const token = await requirePermission(context.userId, 'notion', 'notion.read');
    const query = typeof args.query === 'string' ? args.query.trim() : '';
    const maxResults = typeof args.maxResults === 'string' ? args.maxResults : '10';
    const response = await fetchWithTimeout(`${NOTION_API}/search`, {
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
      await notionError(response, `Notion request failed with status ${response.status}`);
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

type NotionDatabase = {
  id?: string;
  title?: { plain_text?: string }[];
  properties?: Record<string, { id?: string; type?: string }>;
};

export const notionSearchDatabasesTool: Tool = {
  name: 'notion_search_databases',
  description:
    'Search the user\u2019s Notion workspace for databases and return matching database titles, IDs, and their property names.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search text to match against database titles.',
      },
      maxResults: {
        type: 'string',
        description: 'Maximum number of databases to return (default 10).',
      },
    },
  },
  async execute(args, context) {
    const token = await requirePermission(context.userId, 'notion', 'notion.database');
    const query = typeof args.query === 'string' ? args.query.trim() : '';
    const maxResults = typeof args.maxResults === 'string' ? args.maxResults : '10';
    const response = await fetchWithTimeout(`${NOTION_API}/search`, {
      method: 'POST',
      timeoutMs: 10_000,
      headers: notionHeaders(token),
      body: JSON.stringify({
        ...(query ? { query } : {}),
        filter: { value: 'database', property: 'object' },
        page_size: parseInt(maxResults, 10) || 10,
      }),
    });
    if (!response.ok) {
      await notionError(response, `Notion request failed with status ${response.status}`);
    }
    const body = (await response.json()) as { results?: NotionDatabase[] };
    const databases = body.results ?? [];
    if (databases.length === 0) {
      return 'No databases found.';
    }
    const lines = databases.map((database, index) => {
      const title = (database.title ?? []).map((t) => t.plain_text ?? '').join('') || '(untitled)';
      const properties = Object.entries(database.properties ?? {})
        .map(([name, property]) => `${name} (${property?.type ?? 'unknown'})`)
        .join(', ');
      const detail = properties ? ` Properties: ${properties}` : '';
      return `${index + 1}. ${title} (id: ${database.id ?? 'unknown'})${detail}`;
    });
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
    const token = await requirePermission(context.userId, 'notion', 'notion.write');
    const response = await fetchWithTimeout(`${NOTION_API}/pages`, {
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
      await notionError(response, `Notion request failed with status ${response.status}`);
    }
    const page = (await response.json()) as NotionPage;
    return `Page created: "${title}" (id: ${page.id ?? 'unknown'})`;
  },
};

export const notionUpdatePageTool: Tool = {
  name: 'notion_update_page',
  description:
    'Update an existing page in the user\u2019s Notion workspace: change its title and/or move it to the trash (archive).',
  parameters: {
    type: 'object',
    properties: {
      pageId: { type: 'string', description: 'ID of the page to update.' },
      title: {
        type: 'string',
        description: 'New title for the page. Omit to leave the title unchanged.',
      },
      archived: {
        type: 'string',
        description: 'Set to "true" to move the page to the trash, or "false" to restore it.',
      },
    },
    required: ['pageId'],
  },
  async execute(args, context) {
    const pageId = typeof args.pageId === 'string' ? args.pageId.trim() : '';
    if (!pageId) {
      throw new Error('Missing "pageId" argument');
    }
    const title = typeof args.title === 'string' ? args.title.trim() : '';
    const archived = typeof args.archived === 'string' ? args.archived.trim() : '';
    if (!title && archived !== 'true' && archived !== 'false') {
      throw new Error('Provide a new "title", or set "archived" to true or false');
    }
    const body: Record<string, unknown> = {};
    if (title) {
      body.properties = {
        title: {
          title: [{ text: { content: title } }],
        },
      };
    }
    if (archived === 'true' || archived === 'false') {
      body.archived = archived === 'true';
    }
    const token = await requirePermission(context.userId, 'notion', 'notion.write');
    const response = await fetchWithTimeout(`${NOTION_API}/pages/${pageId}`, {
      method: 'PATCH',
      timeoutMs: 10_000,
      headers: notionHeaders(token),
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      await notionError(response, `Notion request failed with status ${response.status}`);
    }
    const page = (await response.json()) as NotionPage;
    const updatedTitle = title || pageTitle(page);
    return `Page updated: "${updatedTitle}" (id: ${page.id ?? pageId})`;
  },
};

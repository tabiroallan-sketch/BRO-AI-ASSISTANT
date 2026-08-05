import { requirePermission } from '../integrations/access.js';
import { fetchWithTimeout } from '../lib/http.js';
import type { Tool } from './types.js';

type DriveFile = {
  id?: string;
  name?: string;
  modifiedTime?: string;
};

type DocTextRun = {
  textRun?: { content?: string };
};

type GoogleDoc = {
  title?: string;
  body?: { content?: DocTextRun[] };
};

function docText(doc: GoogleDoc): string {
  const parts = (doc.body?.content ?? [])
    .filter((element) => element.textRun?.content)
    .map((element) => element.textRun?.content ?? '');
  return parts.join('').trim();
}

export const docsSearchTool: Tool = {
  name: 'docs_search',
  description:
    'Find the user\u2019s Google Documents by name and return their file IDs, most recently modified first.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Optional name filter, e.g. "quarterly report".',
      },
      maxResults: {
        type: 'string',
        description: 'Maximum number of documents to return (default 10).',
      },
    },
  },
  async execute(args, context) {
    const token = await requirePermission(context.userId, 'google-docs', 'docs.list');
    const maxResults = typeof args.maxResults === 'string' ? args.maxResults : '10';
    const query = typeof args.query === 'string' ? args.query.trim() : '';
    const mimeFilter = "mimeType='application/vnd.google-apps.document'";
    const q = query
      ? `${mimeFilter} and name contains '${query.replaceAll("'", "\\'")}'`
      : mimeFilter;
    const params = new URLSearchParams({
      q,
      pageSize: maxResults,
      orderBy: 'modifiedTime desc',
      fields: 'files(id,name,modifiedTime)',
    });
    const response = await fetchWithTimeout(
      `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
      {
        timeoutMs: 10_000,
        headers: { authorization: `Bearer ${token}` },
      },
    );
    if (!response.ok) {
      throw new Error(`Google Docs request failed with status ${response.status}`);
    }
    const body = (await response.json()) as { files?: DriveFile[] };
    const files = body.files ?? [];
    if (files.length === 0) {
      return 'No documents found.';
    }
    const lines = files.map(
      (file, index) =>
        `${index + 1}. ${file.name ?? '(unnamed)'} (id: ${file.id ?? 'unknown'}, modified ${file.modifiedTime ?? 'unknown'})`,
    );
    return lines.join('\n');
  },
};

export const docsReadTool: Tool = {
  name: 'docs_read',
  description:
    'Read the text content of a Google Document by its file ID and return the plain text.',
  parameters: {
    type: 'object',
    properties: {
      documentId: {
        type: 'string',
        description: 'The Google Document file ID (from the document URL or docs_search).',
      },
    },
    required: ['documentId'],
  },
  async execute(args, context) {
    const documentId = typeof args.documentId === 'string' ? args.documentId.trim() : '';
    if (!documentId) {
      throw new Error('Missing "documentId" argument');
    }
    const token = await requirePermission(context.userId, 'google-docs', 'docs.read');
    const response = await fetchWithTimeout(
      `https://docs.googleapis.com/v1/documents/${encodeURIComponent(documentId)}`,
      {
        timeoutMs: 10_000,
        headers: { authorization: `Bearer ${token}` },
      },
    );
    if (!response.ok) {
      throw new Error(`Google Docs request failed with status ${response.status}`);
    }
    const doc = (await response.json()) as GoogleDoc;
    const text = docText(doc);
    if (!text) {
      return `Document "${doc.title ?? documentId}" is empty.`;
    }
    return `Title: ${doc.title ?? '(untitled)'}\n\n${text}`;
  },
};

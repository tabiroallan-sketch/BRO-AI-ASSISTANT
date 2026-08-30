import { requirePermission } from '../integrations/access.js';
import { fetchWithTimeout } from '../lib/http.js';
import type { Tool } from './types.js';

type DriveFile = {
  id?: string;
  name?: string;
  modifiedTime?: string;
};

type DocElement = {
  startIndex?: number;
  endIndex?: number;
  textRun?: { content?: string };
};

type GoogleDoc = {
  documentId?: string;
  title?: string;
  body?: {
    content?: DocElement[];
  };
};

type BatchUpdateRequest = {
  requests: unknown[];
};

function docText(doc: GoogleDoc): string {
  const parts = (doc.body?.content ?? [])
    .filter((element) => element.textRun?.content)
    .map((element) => element.textRun?.content ?? '');
  return parts.join('').trim();
}

function lastBodyIndex(doc: GoogleDoc): number {
  const content = doc.body?.content ?? [];
  const last = content[content.length - 1];
  if (!last) return 1;
  return last.endIndex ?? 1;
}

export const docsSearchTool: Tool = {
  name: 'docs_search',
  providerId: 'google-docs',
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
  providerId: 'google-docs',
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

export const docsCreateTool: Tool = {
  name: 'docs_create',
  providerId: 'google-docs',
  description: 'Create a new Google Document with an optional title and initial text.',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Document title (optional).' },
      content: { type: 'string', description: 'Optional initial text content to insert.' },
      parentId: {
        type: 'string',
        description: 'Optional Drive folder ID to create the document in.',
      },
    },
  },
  async execute(args, context) {
    const token = await requirePermission(context.userId, 'google-docs', 'docs.read');
    const title = typeof args.title === 'string' ? args.title.trim() : '';
    const content = typeof args.content === 'string' ? args.content.trim() : '';
    const parentId = typeof args.parentId === 'string' ? args.parentId.trim() : '';

    const createParams: Record<string, unknown> = {};
    if (title) createParams.title = title;
    if (parentId) createParams.parent = parentId;

    const createResponse = await fetchWithTimeout('https://docs.googleapis.com/v1/documents', {
      timeoutMs: 10_000,
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(createParams),
    });
    if (!createResponse.ok) {
      throw new Error(`Google Docs request failed with status ${createResponse.status}`);
    }
    const doc = (await createResponse.json()) as GoogleDoc;
    const docId = doc.documentId ?? '';

    if (content && docId) {
      const endIdx = lastBodyIndex(doc);
      const batchBody: BatchUpdateRequest = {
        requests: [
          {
            insertText: {
              location: { index: endIdx > 1 ? endIdx - 1 : 1 },
              text: content,
            },
          },
        ],
      };
      await fetchWithTimeout(
        `https://docs.googleapis.com/v1/documents/${encodeURIComponent(docId)}:batchUpdate`,
        {
          timeoutMs: 10_000,
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify(batchBody),
        },
      );
    }
    return `Document created: "${doc.title ?? title ?? '(untitled)'}" (id: ${docId})`;
  },
};

export const docsAppendTool: Tool = {
  name: 'docs_append',
  providerId: 'google-docs',
  description: 'Append text to the end of a Google Document.',
  parameters: {
    type: 'object',
    properties: {
      documentId: { type: 'string', description: 'The document ID.' },
      content: { type: 'string', description: 'Text to append.' },
    },
    required: ['documentId', 'content'],
  },
  async execute(args, context) {
    const documentId = typeof args.documentId === 'string' ? args.documentId.trim() : '';
    const content = typeof args.content === 'string' ? args.content.trim() : '';
    if (!documentId || !content) {
      throw new Error('Missing "documentId" or "content" argument');
    }
    const token = await requirePermission(context.userId, 'google-docs', 'docs.read');

    const docRes = await fetchWithTimeout(
      `https://docs.googleapis.com/v1/documents/${encodeURIComponent(documentId)}`,
      {
        timeoutMs: 10_000,
        headers: { authorization: `Bearer ${token}` },
      },
    );
    if (!docRes.ok) {
      throw new Error(`Google Docs request failed with status ${docRes.status}`);
    }
    const doc = (await docRes.json()) as GoogleDoc;
    const endIdx = lastBodyIndex(doc);

    const batchBody: BatchUpdateRequest = {
      requests: [
        {
          insertText: {
            location: { index: endIdx > 1 ? endIdx - 1 : 1 },
            text: content,
          },
        },
      ],
    };
    const response = await fetchWithTimeout(
      `https://docs.googleapis.com/v1/documents/${encodeURIComponent(documentId)}:batchUpdate`,
      {
        timeoutMs: 10_000,
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(batchBody),
      },
    );
    if (!response.ok) {
      throw new Error(`Google Docs request failed with status ${response.status}`);
    }
    return `Appended ${content.length} characters to "${doc.title ?? documentId}"`;
  },
};

export const docsReplaceTool: Tool = {
  name: 'docs_replace_text',
  providerId: 'google-docs',
  description: 'Replace all occurrences of a text string in a Google Document with new text.',
  parameters: {
    type: 'object',
    properties: {
      documentId: { type: 'string', description: 'The document ID.' },
      findText: { type: 'string', description: 'Text to find and replace.' },
      replaceText: { type: 'string', description: 'Replacement text.' },
    },
    required: ['documentId', 'findText', 'replaceText'],
  },
  async execute(args, context) {
    const documentId = typeof args.documentId === 'string' ? args.documentId.trim() : '';
    const findText = typeof args.findText === 'string' ? args.findText : '';
    const replaceText = typeof args.replaceText === 'string' ? args.replaceText : '';
    if (!documentId || !findText) {
      throw new Error('Missing "documentId" or "findText" argument');
    }
    const token = await requirePermission(context.userId, 'google-docs', 'docs.read');

    const docRes = await fetchWithTimeout(
      `https://docs.googleapis.com/v1/documents/${encodeURIComponent(documentId)}`,
      {
        timeoutMs: 10_000,
        headers: { authorization: `Bearer ${token}` },
      },
    );
    if (!docRes.ok) {
      throw new Error(`Google Docs request failed with status ${docRes.status}`);
    }
    const doc = (await docRes.json()) as GoogleDoc;

    const batchBody: BatchUpdateRequest = {
      requests: [
        {
          replaceAllText: {
            containsText: { text: findText, matchCase: true },
            replaceText,
          },
        },
      ],
    };
    const response = await fetchWithTimeout(
      `https://docs.googleapis.com/v1/documents/${encodeURIComponent(documentId)}:batchUpdate`,
      {
        timeoutMs: 10_000,
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(batchBody),
      },
    );
    if (!response.ok) {
      throw new Error(`Google Docs request failed with status ${response.status}`);
    }
    return `Replaced text in "${doc.title ?? documentId}"`;
  },
};

export const docsInsertTextTool: Tool = {
  name: 'docs_insert_text',
  providerId: 'google-docs',
  description: 'Insert text at a specific character index in a Google Document.',
  parameters: {
    type: 'object',
    properties: {
      documentId: { type: 'string', description: 'The document ID.' },
      index: {
        type: 'string',
        description: 'Character index to insert at (0 = start of document).',
      },
      content: { type: 'string', description: 'Text to insert.' },
    },
    required: ['documentId', 'index', 'content'],
  },
  async execute(args, context) {
    const documentId = typeof args.documentId === 'string' ? args.documentId.trim() : '';
    const indexStr = typeof args.index === 'string' ? args.index.trim() : '';
    const content = typeof args.content === 'string' ? args.content : '';
    if (!documentId || !indexStr || !content) {
      throw new Error('Missing "documentId", "index", or "content" argument');
    }
    const index = parseInt(indexStr, 10);
    if (Number.isNaN(index) || index < 0) {
      throw new Error('"index" must be a non-negative integer');
    }
    const token = await requirePermission(context.userId, 'google-docs', 'docs.read');

    const docRes = await fetchWithTimeout(
      `https://docs.googleapis.com/v1/documents/${encodeURIComponent(documentId)}`,
      {
        timeoutMs: 10_000,
        headers: { authorization: `Bearer ${token}` },
      },
    );
    if (!docRes.ok) {
      throw new Error(`Google Docs request failed with status ${docRes.status}`);
    }
    const doc = (await docRes.json()) as GoogleDoc;

    const batchBody: BatchUpdateRequest = {
      requests: [
        {
          insertText: {
            location: { index },
            text: content,
          },
        },
      ],
    };
    const response = await fetchWithTimeout(
      `https://docs.googleapis.com/v1/documents/${encodeURIComponent(documentId)}:batchUpdate`,
      {
        timeoutMs: 10_000,
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(batchBody),
      },
    );
    if (!response.ok) {
      throw new Error(`Google Docs request failed with status ${response.status}`);
    }
    return `Inserted ${content.length} characters at index ${index} in "${doc.title ?? documentId}"`;
  },
};

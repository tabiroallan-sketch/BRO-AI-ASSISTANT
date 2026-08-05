import { requirePermission } from '../integrations/access.js';
import { fetchWithTimeout } from '../lib/http.js';
import type { Tool } from './types.js';

type DriveFile = {
  id?: string;
  name?: string;
  modifiedTime?: string;
};

export const sheetsListTool: Tool = {
  name: 'sheets_list',
  description:
    'Find the user\u2019s Google Sheets by name and return their spreadsheet IDs, most recently modified first.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Optional name filter, e.g. "budget".',
      },
      maxResults: {
        type: 'string',
        description: 'Maximum number of spreadsheets to return (default 10).',
      },
    },
  },
  async execute(args, context) {
    const token = await requirePermission(context.userId, 'google-sheets', 'sheets.list');
    const maxResults = typeof args.maxResults === 'string' ? args.maxResults : '10';
    const query = typeof args.query === 'string' ? args.query.trim() : '';
    const mimeFilter = "mimeType='application/vnd.google-apps.spreadsheet'";
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
      throw new Error(`Google Sheets request failed with status ${response.status}`);
    }
    const body = (await response.json()) as { files?: DriveFile[] };
    const files = body.files ?? [];
    if (files.length === 0) {
      return 'No spreadsheets found.';
    }
    const lines = files.map(
      (file, index) =>
        `${index + 1}. ${file.name ?? '(unnamed)'} (id: ${file.id ?? 'unknown'}, modified ${file.modifiedTime ?? 'unknown'})`,
    );
    return lines.join('\n');
  },
};

export const sheetsReadTool: Tool = {
  name: 'sheets_read',
  description:
    'Read cell values from a Google Sheet by its spreadsheet ID and an A1 range, returning rows of values.',
  parameters: {
    type: 'object',
    properties: {
      spreadsheetId: {
        type: 'string',
        description: 'The Google Sheet spreadsheet ID (from the URL or sheets_list).',
      },
      range: {
        type: 'string',
        description: 'Optional A1 range to read, e.g. "Sheet1!A1:F20" (default "A1:F100").',
      },
    },
    required: ['spreadsheetId'],
  },
  async execute(args, context) {
    const spreadsheetId = typeof args.spreadsheetId === 'string' ? args.spreadsheetId.trim() : '';
    if (!spreadsheetId) {
      throw new Error('Missing "spreadsheetId" argument');
    }
    const range =
      typeof args.range === 'string' && args.range.trim() ? args.range.trim() : 'A1:F100';
    const token = await requirePermission(context.userId, 'google-sheets', 'sheets.read');
    const response = await fetchWithTimeout(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`,
      {
        timeoutMs: 10_000,
        headers: { authorization: `Bearer ${token}` },
      },
    );
    if (!response.ok) {
      throw new Error(`Google Sheets request failed with status ${response.status}`);
    }
    const body = (await response.json()) as { values?: unknown[][] };
    const rows = body.values ?? [];
    if (rows.length === 0) {
      return `Range ${range} is empty.`;
    }
    const lines = rows.map((row) => row.map((cell) => String(cell ?? '')).join(' | '));
    return `Range ${range}:\n${lines.join('\n')}`;
  },
};

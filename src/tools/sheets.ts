import { requirePermission } from '../integrations/access.js';
import { fetchWithTimeout } from '../lib/http.js';
import type { Tool } from './types.js';

type DriveFile = {
  id?: string;
  name?: string;
  modifiedTime?: string;
};

type SpreadsheetProperties = {
  title?: string;
};

type Spreadsheet = {
  spreadsheetId?: string;
  properties?: SpreadsheetProperties;
  sheets?: { properties?: { title?: string; sheetId?: number } }[];
};

const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';

export const sheetsListTool: Tool = {
  name: 'sheets_list',
  providerId: 'google-sheets',
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
    const response = await fetchWithTimeout(`${DRIVE_API}/files?${params.toString()}`, {
      timeoutMs: 10_000,
      headers: { authorization: `Bearer ${token}` },
    });
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
  providerId: 'google-sheets',
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
      `${SHEETS_API}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`,
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

export const sheetsWriteTool: Tool = {
  name: 'sheets_write',
  providerId: 'google-sheets',
  description:
    'Write values to a Google Sheet range. Each row is a pipe-separated string or a JSON array.',
  parameters: {
    type: 'object',
    properties: {
      spreadsheetId: { type: 'string', description: 'The spreadsheet ID.' },
      range: {
        type: 'string',
        description: 'A1 range to write to, e.g. "Sheet1!A1:C3".',
      },
      values: {
        type: 'string',
        description: 'JSON array of arrays, e.g. [["Name","Age"],["Alice","30"]].',
      },
    },
    required: ['spreadsheetId', 'range', 'values'],
  },
  async execute(args, context) {
    const spreadsheetId = typeof args.spreadsheetId === 'string' ? args.spreadsheetId.trim() : '';
    const range = typeof args.range === 'string' ? args.range.trim() : '';
    const valuesStr = typeof args.values === 'string' ? args.values.trim() : '';
    if (!spreadsheetId || !range || !valuesStr) {
      throw new Error('Missing "spreadsheetId", "range", or "values" argument');
    }
    let values: unknown[][];
    try {
      const parsed = JSON.parse(valuesStr);
      if (!Array.isArray(parsed)) throw new Error();
      values = parsed.map((row) => (Array.isArray(row) ? row : [row]));
    } catch {
      throw new Error('"values" must be a JSON array of arrays, e.g. [["A","B"],["1","2"]]');
    }
    const token = await requirePermission(context.userId, 'google-sheets', 'sheets.read');
    const response = await fetchWithTimeout(
      `${SHEETS_API}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
      {
        timeoutMs: 10_000,
        method: 'PUT',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ values }),
      },
    );
    if (!response.ok) {
      throw new Error(`Google Sheets request failed with status ${response.status}`);
    }
    const body = (await response.json()) as { updatedRows?: number; updatedCells?: number };
    return `Updated ${body.updatedRows ?? 0} rows (${body.updatedCells ?? 0} cells) in range ${range}`;
  },
};

export const sheetsAppendTool: Tool = {
  name: 'sheets_append',
  providerId: 'google-sheets',
  description: 'Append rows to the end of a range in a Google Sheet.',
  parameters: {
    type: 'object',
    properties: {
      spreadsheetId: { type: 'string', description: 'The spreadsheet ID.' },
      range: {
        type: 'string',
        description: 'A1 range to append after, e.g. "Sheet1!A:C".',
      },
      values: {
        type: 'string',
        description: 'JSON array of arrays to append, e.g. [["New Name","35"]].',
      },
    },
    required: ['spreadsheetId', 'range', 'values'],
  },
  async execute(args, context) {
    const spreadsheetId = typeof args.spreadsheetId === 'string' ? args.spreadsheetId.trim() : '';
    const range = typeof args.range === 'string' ? args.range.trim() : '';
    const valuesStr = typeof args.values === 'string' ? args.values.trim() : '';
    if (!spreadsheetId || !range || !valuesStr) {
      throw new Error('Missing "spreadsheetId", "range", or "values" argument');
    }
    let values: unknown[][];
    try {
      const parsed = JSON.parse(valuesStr);
      if (!Array.isArray(parsed)) throw new Error();
      values = parsed.map((row) => (Array.isArray(row) ? row : [row]));
    } catch {
      throw new Error('"values" must be a JSON array of arrays');
    }
    const token = await requirePermission(context.userId, 'google-sheets', 'sheets.read');
    const response = await fetchWithTimeout(
      `${SHEETS_API}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
      {
        timeoutMs: 10_000,
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ values }),
      },
    );
    if (!response.ok) {
      throw new Error(`Google Sheets request failed with status ${response.status}`);
    }
    const body = (await response.json()) as {
      updates?: { updatedRows?: number; updatedCells?: number };
    };
    return `Appended ${body.updates?.updatedRows ?? 0} rows (${body.updates?.updatedCells ?? 0} cells)`;
  },
};

export const sheetsCreateTool: Tool = {
  name: 'sheets_create',
  providerId: 'google-sheets',
  description: 'Create a new Google Spreadsheet with an optional title.',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Spreadsheet title (optional).' },
    },
  },
  async execute(args, context) {
    const token = await requirePermission(context.userId, 'google-sheets', 'sheets.read');
    const title =
      typeof args.title === 'string' && args.title.trim()
        ? args.title.trim()
        : 'Untitled Spreadsheet';
    const response = await fetchWithTimeout(SHEETS_API, {
      timeoutMs: 10_000,
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ properties: { title } }),
    });
    if (!response.ok) {
      throw new Error(`Google Sheets request failed with status ${response.status}`);
    }
    const spreadsheet = (await response.json()) as Spreadsheet;
    const sheetNames = (spreadsheet.sheets ?? [])
      .map((s) => s.properties?.title)
      .filter(Boolean)
      .join(', ');
    return `Spreadsheet created: "${title}" (id: ${spreadsheet.spreadsheetId ?? 'unknown'}, sheets: ${sheetNames || 'Sheet1'})`;
  },
};

export const sheetsClearTool: Tool = {
  name: 'sheets_clear',
  providerId: 'google-sheets',
  description: 'Clear all values from a range in a Google Sheet.',
  requireConfirmation: true,
  parameters: {
    type: 'object',
    properties: {
      spreadsheetId: { type: 'string', description: 'The spreadsheet ID.' },
      range: { type: 'string', description: 'A1 range to clear, e.g. "Sheet1!A1:Z100".' },
    },
    required: ['spreadsheetId', 'range'],
  },
  async execute(args, context) {
    const spreadsheetId = typeof args.spreadsheetId === 'string' ? args.spreadsheetId.trim() : '';
    const range = typeof args.range === 'string' ? args.range.trim() : '';
    if (!spreadsheetId || !range) {
      throw new Error('Missing "spreadsheetId" or "range" argument');
    }
    const token = await requirePermission(context.userId, 'google-sheets', 'sheets.read');
    const response = await fetchWithTimeout(
      `${SHEETS_API}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}:clear`,
      {
        timeoutMs: 10_000,
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({}),
      },
    );
    if (!response.ok) {
      throw new Error(`Google Sheets request failed with status ${response.status}`);
    }
    return `Range ${range} cleared.`;
  },
};

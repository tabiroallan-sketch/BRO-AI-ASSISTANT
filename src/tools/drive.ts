import { randomUUID } from 'node:crypto';
import { requirePermission } from '../integrations/access.js';
import type { Tool } from './types.js';
import { fetchWithTimeout } from '../lib/http.js';

type DriveFile = {
  id?: string;
  name?: string;
  mimeType?: string;
  modifiedTime?: string;
};

const GOOGLE_APP_MIME_PREFIX = 'application/vnd.google-apps.';

export const driveListFilesTool: Tool = {
  name: 'drive_list_files',
  providerId: 'google-drive',
  description:
    'List files from the user\u2019s Google Drive, most recently modified first, with name, type, and modified time.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description:
          'Optional Drive query filter, e.g. "name contains \'report\'" or "mimeType=\'application/pdf\'".',
      },
      maxResults: {
        type: 'string',
        description: 'Maximum number of files to return (default 10).',
      },
    },
  },
  async execute(args, context) {
    const token = await requirePermission(context.userId, 'google-drive', 'drive.read');
    const maxResults = typeof args.maxResults === 'string' ? args.maxResults : '10';
    const query = typeof args.query === 'string' ? args.query.trim() : '';
    const params = new URLSearchParams({
      pageSize: maxResults,
      orderBy: 'modifiedTime desc',
      fields: 'files(id,name,mimeType,modifiedTime)',
      ...(query ? { q: query } : {}),
    });
    const response = await fetchWithTimeout(
      `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
      {
        timeoutMs: 10_000,
        headers: { authorization: `Bearer ${token}` },
      },
    );
    if (!response.ok) {
      throw new Error(`Google Drive request failed with status ${response.status}`);
    }
    const body = (await response.json()) as { files?: DriveFile[] };
    const files = body.files ?? [];
    if (files.length === 0) {
      return 'No files found.';
    }
    const lines = files.map((file, index) => {
      const type = file.mimeType?.split('.').pop() ?? 'file';
      return `${index + 1}. ${file.name ?? '(unnamed)'} (${type}, modified ${file.modifiedTime ?? 'unknown'})`;
    });
    return lines.join('\n');
  },
};

export const driveReadFileTool: Tool = {
  name: 'drive_read_file',
  providerId: 'google-drive',
  description:
    'Read the contents of a file from the user\u2019s Google Drive by its ID and return it as text.',
  parameters: {
    type: 'object',
    properties: {
      fileId: {
        type: 'string',
        description: 'Google Drive file ID (from drive_list_files).',
      },
    },
    required: ['fileId'],
  },
  async execute(args, context) {
    const fileId = typeof args.fileId === 'string' ? args.fileId.trim() : '';
    if (!fileId) {
      throw new Error('Missing "fileId" argument');
    }
    const token = await requirePermission(context.userId, 'google-drive', 'drive.read');

    const metaResponse = await fetchWithTimeout(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=name,mimeType`,
      {
        timeoutMs: 10_000,
        headers: { authorization: `Bearer ${token}` },
      },
    );
    if (!metaResponse.ok) {
      throw new Error(`Google Drive request failed with status ${metaResponse.status}`);
    }
    const meta = (await metaResponse.json()) as { name?: string; mimeType?: string };
    const isNative = (meta.mimeType ?? '').startsWith(GOOGLE_APP_MIME_PREFIX);
    const url = isNative
      ? `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=text%2Fplain`
      : `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;
    const contentResponse = await fetchWithTimeout(url, {
      timeoutMs: 15_000,
      headers: { authorization: `Bearer ${token}` },
    });
    if (!contentResponse.ok) {
      throw new Error(`Google Drive request failed with status ${contentResponse.status}`);
    }
    const text = await contentResponse.text();
    const truncated = text.length > 20_000 ? `${text.slice(0, 20_000)}\n… (truncated)` : text;
    return `File: ${meta.name ?? fileId} (${meta.mimeType ?? 'unknown'})\n\n${truncated || '(empty file)'}`;
  },
};

export const driveUploadFileTool: Tool = {
  name: 'drive_upload_file',
  providerId: 'google-drive',
  description:
    'Upload a text file to the user\u2019s Google Drive and return the new file ID. Creates a new file.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'File name to create in Drive.' },
      content: { type: 'string', description: 'Text content of the file.' },
      mimeType: {
        type: 'string',
        description: 'Optional MIME type of the file content (default "text/plain").',
      },
      parentId: {
        type: 'string',
        description: 'Optional folder ID to upload the file into.',
      },
    },
    required: ['name', 'content'],
  },
  async execute(args, context) {
    const name = typeof args.name === 'string' ? args.name.trim() : '';
    const content = typeof args.content === 'string' ? args.content : '';
    if (!name) {
      throw new Error('Missing "name" argument');
    }
    const mimeType =
      typeof args.mimeType === 'string' && args.mimeType.trim()
        ? args.mimeType.trim()
        : 'text/plain';
    const parentId = typeof args.parentId === 'string' ? args.parentId.trim() : '';
    const token = await requirePermission(context.userId, 'google-drive', 'drive.write');

    const boundary = `bRO_${randomUUID()}`;
    const metadata = JSON.stringify({
      name,
      mimeType,
      ...(parentId ? { parents: [parentId] } : {}),
    });
    const body = [
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      metadata,
      `--${boundary}`,
      `Content-Type: ${mimeType}; charset=UTF-8`,
      '',
      content,
      `--${boundary}--`,
    ].join('\r\n');
    const response = await fetchWithTimeout(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
      {
        timeoutMs: 15_000,
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': `multipart/related; boundary=${boundary}`,
        },
        body,
      },
    );
    if (!response.ok) {
      throw new Error(`Google Drive request failed with status ${response.status}`);
    }
    const created = (await response.json()) as { id?: string; name?: string };
    return `Uploaded ${created.name ?? name} (id: ${created.id ?? 'unknown'})`;
  },
};

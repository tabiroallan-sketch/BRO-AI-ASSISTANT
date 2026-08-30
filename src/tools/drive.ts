import { randomUUID } from 'node:crypto';
import { requirePermission } from '../integrations/access.js';
import type { Tool } from './types.js';
import { fetchWithTimeout } from '../lib/http.js';

type DriveFile = {
  id?: string;
  name?: string;
  mimeType?: string;
  modifiedTime?: string;
  createdTime?: string;
  size?: string;
  parents?: string[];
  webViewLink?: string;
};

const GOOGLE_APP_MIME_PREFIX = 'application/vnd.google-apps.';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';

async function driveRequest(
  token: string,
  url: string,
  init: { method?: string; body?: string; headers?: Record<string, string> } = {},
): Promise<Response> {
  return fetchWithTimeout(url, {
    timeoutMs: 10_000,
    method: init.method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
    body: init.body,
  });
}

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
    const response = await driveRequest(token, `${DRIVE_API}/files?${params.toString()}`);
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

    const metaResponse = await driveRequest(
      token,
      `${DRIVE_API}/files/${encodeURIComponent(fileId)}?fields=name,mimeType`,
    );
    if (!metaResponse.ok) {
      throw new Error(`Google Drive request failed with status ${metaResponse.status}`);
    }
    const meta = (await metaResponse.json()) as { name?: string; mimeType?: string };
    const isNative = (meta.mimeType ?? '').startsWith(GOOGLE_APP_MIME_PREFIX);
    const url = isNative
      ? `${DRIVE_API}/files/${encodeURIComponent(fileId)}/export?mimeType=text%2Fplain`
      : `${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media`;
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
    const response = await fetchWithTimeout(`${DRIVE_UPLOAD_API}/files?uploadType=multipart`, {
      timeoutMs: 15_000,
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': `multipart/related; boundary=${boundary}`,
      },
      body,
    });
    if (!response.ok) {
      throw new Error(`Google Drive request failed with status ${response.status}`);
    }
    const created = (await response.json()) as { id?: string; name?: string };
    return `Uploaded ${created.name ?? name} (id: ${created.id ?? 'unknown'})`;
  },
};

export const driveCreateFolderTool: Tool = {
  name: 'drive_create_folder',
  providerId: 'google-drive',
  description: 'Create a new folder in the user\u2019s Google Drive.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Folder name.' },
      parentId: {
        type: 'string',
        description: 'Optional parent folder ID. Defaults to the root of My Drive.',
      },
    },
    required: ['name'],
  },
  async execute(args, context) {
    const name = typeof args.name === 'string' ? args.name.trim() : '';
    if (!name) {
      throw new Error('Missing "name" argument');
    }
    const parentId = typeof args.parentId === 'string' ? args.parentId.trim() : '';
    const token = await requirePermission(context.userId, 'google-drive', 'drive.write');
    const metadata: Record<string, unknown> = {
      name,
      mimeType: 'application/vnd.google-apps.folder',
    };
    if (parentId) {
      metadata.parents = [parentId];
    }
    const response = await driveRequest(token, `${DRIVE_API}/files`, {
      method: 'POST',
      body: JSON.stringify(metadata),
    });
    if (!response.ok) {
      throw new Error(`Google Drive request failed with status ${response.status}`);
    }
    const created = (await response.json()) as DriveFile;
    return `Folder "${created.name ?? name}" created (id: ${created.id ?? 'unknown'})`;
  },
};

export const driveDeleteFileTool: Tool = {
  name: 'drive_delete_file',
  providerId: 'google-drive',
  description: 'Permanently delete a file or folder from the user\u2019s Google Drive.',
  requireConfirmation: true,
  parameters: {
    type: 'object',
    properties: {
      fileId: { type: 'string', description: 'The file or folder ID to delete.' },
    },
    required: ['fileId'],
  },
  async execute(args, context) {
    const fileId = typeof args.fileId === 'string' ? args.fileId.trim() : '';
    if (!fileId) {
      throw new Error('Missing "fileId" argument');
    }
    const token = await requirePermission(context.userId, 'google-drive', 'drive.write');
    const response = await driveRequest(token, `${DRIVE_API}/files/${encodeURIComponent(fileId)}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      throw new Error(`Google Drive request failed with status ${response.status}`);
    }
    return `File ${fileId} deleted.`;
  },
};

export const driveMoveFileTool: Tool = {
  name: 'drive_move_file',
  providerId: 'google-drive',
  description: 'Move a file to a different folder in Google Drive by updating its parent.',
  parameters: {
    type: 'object',
    properties: {
      fileId: { type: 'string', description: 'The file ID to move.' },
      folderId: {
        type: 'string',
        description: 'The destination folder ID. Use "root" to move to My Drive root.',
      },
    },
    required: ['fileId', 'folderId'],
  },
  async execute(args, context) {
    const fileId = typeof args.fileId === 'string' ? args.fileId.trim() : '';
    const folderId = typeof args.folderId === 'string' ? args.folderId.trim() : '';
    if (!fileId || !folderId) {
      throw new Error('Missing "fileId" or "folderId" argument');
    }
    const token = await requirePermission(context.userId, 'google-drive', 'drive.write');

    const metaRes = await driveRequest(
      token,
      `${DRIVE_API}/files/${encodeURIComponent(fileId)}?fields=name,parents`,
    );
    if (!metaRes.ok) {
      throw new Error(`Failed to read file metadata: ${metaRes.status}`);
    }
    const meta = (await metaRes.json()) as DriveFile;
    const currentParents = (meta.parents ?? []).join(',');

    const updateParams = new URLSearchParams({
      addParents: folderId,
      removeParents: currentParents,
      fields: 'id,name',
    });
    const response = await driveRequest(
      token,
      `${DRIVE_API}/files/${encodeURIComponent(fileId)}?${updateParams.toString()}`,
      { method: 'PATCH', body: JSON.stringify({}) },
    );
    if (!response.ok) {
      throw new Error(`Google Drive request failed with status ${response.status}`);
    }
    const updated = (await response.json()) as DriveFile;
    return `Moved "${updated.name ?? fileId}" to folder ${folderId}`;
  },
};

export const driveCopyFileTool: Tool = {
  name: 'drive_copy_file',
  providerId: 'google-drive',
  description: 'Create a copy of a file in the user\u2019s Google Drive.',
  parameters: {
    type: 'object',
    properties: {
      fileId: { type: 'string', description: 'The file ID to copy.' },
      name: { type: 'string', description: 'Optional name for the copy.' },
      folderId: {
        type: 'string',
        description: 'Optional destination folder ID for the copy.',
      },
    },
    required: ['fileId'],
  },
  async execute(args, context) {
    const fileId = typeof args.fileId === 'string' ? args.fileId.trim() : '';
    if (!fileId) {
      throw new Error('Missing "fileId" argument');
    }
    const token = await requirePermission(context.userId, 'google-drive', 'drive.write');
    const payload: Record<string, unknown> = {};
    const name = typeof args.name === 'string' ? args.name.trim() : '';
    const folderId = typeof args.folderId === 'string' ? args.folderId.trim() : '';
    if (name) payload.name = name;
    if (folderId) payload.parents = [folderId];
    const response = await driveRequest(
      token,
      `${DRIVE_API}/files/${encodeURIComponent(fileId)}/copy`,
      { method: 'POST', body: JSON.stringify(payload) },
    );
    if (!response.ok) {
      throw new Error(`Google Drive request failed with status ${response.status}`);
    }
    const copied = (await response.json()) as DriveFile;
    return `Copied "${copied.name ?? fileId}" (new id: ${copied.id ?? 'unknown'})`;
  },
};

export const driveGetMetadataTool: Tool = {
  name: 'drive_get_file_metadata',
  providerId: 'google-drive',
  description:
    'Get detailed metadata for a Google Drive file: name, type, size, created/modified dates, and link.',
  parameters: {
    type: 'object',
    properties: {
      fileId: { type: 'string', description: 'The file ID.' },
    },
    required: ['fileId'],
  },
  async execute(args, context) {
    const fileId = typeof args.fileId === 'string' ? args.fileId.trim() : '';
    if (!fileId) {
      throw new Error('Missing "fileId" argument');
    }
    const token = await requirePermission(context.userId, 'google-drive', 'drive.read');
    const fields = 'name,mimeType,size,createdTime,modifiedTime,webViewLink,parents';
    const response = await driveRequest(
      token,
      `${DRIVE_API}/files/${encodeURIComponent(fileId)}?fields=${fields}`,
    );
    if (!response.ok) {
      throw new Error(`Google Drive request failed with status ${response.status}`);
    }
    const file = (await response.json()) as DriveFile;
    const size = file.size ? `${Math.round(Number(file.size) / 1024)} KB` : 'N/A';
    const lines = [
      `Name: ${file.name ?? '(unnamed)'}`,
      `Type: ${file.mimeType ?? 'unknown'}`,
      `Size: ${size}`,
      `Created: ${file.createdTime ?? 'unknown'}`,
      `Modified: ${file.modifiedTime ?? 'unknown'}`,
      `Parents: ${(file.parents ?? []).join(', ') || 'root'}`,
      `Link: ${file.webViewLink ?? 'N/A'}`,
    ];
    return lines.join('\n');
  },
};

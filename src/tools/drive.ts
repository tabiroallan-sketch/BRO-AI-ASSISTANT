import { requireProviderToken } from '../integrations/access.js';
import type { Tool } from './types.js';

type DriveFile = {
  id?: string;
  name?: string;
  mimeType?: string;
  modifiedTime?: string;
};

export const driveListFilesTool: Tool = {
  name: 'drive_list_files',
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
    const token = await requireProviderToken(context.userId, 'google-drive');
    const maxResults = typeof args.maxResults === 'string' ? args.maxResults : '10';
    const query = typeof args.query === 'string' ? args.query.trim() : '';
    const params = new URLSearchParams({
      pageSize: maxResults,
      orderBy: 'modifiedTime desc',
      fields: 'files(id,name,mimeType,modifiedTime)',
      ...(query ? { q: query } : {}),
    });
    const response = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, {
      headers: { authorization: `Bearer ${token}` },
    });
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

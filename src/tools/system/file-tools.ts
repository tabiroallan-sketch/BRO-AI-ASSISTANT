import type { Tool } from '../types.js';
import { fileOps } from './ops.js';

export const systemSearchFilesTool: Tool = {
  name: 'system_search_files',
  description:
    'Search for files and folders on the computer by name (case-insensitive substring match). Returns absolute paths. Non-destructive; no confirmation needed.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Part of the file or folder name to search for.' },
      root: {
        type: 'string',
        description:
          'Directory to search from (defaults to the BRO install directory). Use a drive root like "C:\\" to search wider.',
      },
      depth: {
        type: 'number',
        description: 'Maximum folder depth to descend (default 6, max 12).',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of matches to return (default 50, max 200).',
      },
    },
    required: ['query'],
  },
  async execute(args) {
    const query = typeof args.query === 'string' ? args.query : '';
    const options: { root?: string; depth?: number; limit?: number } = {};
    if (typeof args.root === 'string' && args.root.trim()) {
      options.root = args.root;
    }
    if (typeof args.depth === 'number') {
      options.depth = args.depth;
    }
    if (typeof args.limit === 'number') {
      options.limit = args.limit;
    }
    const matches = await fileOps.searchFiles(query, options);
    if (matches.length === 0) {
      return `No files matched "${query}".`;
    }
    const list = matches.map((entry) => `${entry.type === 'dir' ? 'dir' : 'file'} ${entry.path}`);
    return list.join('\n');
  },
};

export const systemRenameTool: Tool = {
  name: 'system_rename',
  description:
    'Rename or move a file or folder to a new absolute path. "source" is the current path and "destination" is the target path (a full path, not just a new name). Requires explicit user confirmation before it runs.',
  parameters: {
    type: 'object',
    properties: {
      source: { type: 'string', description: 'Absolute path of the file or folder to move.' },
      destination: { type: 'string', description: 'Absolute target path.' },
    },
    required: ['source', 'destination'],
  },
  requireConfirmation: true,
  async execute(args) {
    const source = typeof args.source === 'string' ? args.source : '';
    const destination = typeof args.destination === 'string' ? args.destination : '';
    return fileOps.renamePath(source, destination);
  },
};

export const systemDeleteTool: Tool = {
  name: 'system_delete',
  description:
    'Delete a file or folder from the computer. The item is moved to the Recycle Bin (it is never permanently erased). Requires explicit user confirmation before it runs.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Absolute path of the file or folder to delete.' },
    },
    required: ['path'],
  },
  requireConfirmation: true,
  async execute(args) {
    const path = typeof args.path === 'string' ? args.path : '';
    return fileOps.deletePath(path);
  },
};

export const systemCreateFolderTool: Tool = {
  name: 'system_create_folder',
  description:
    'Create a new folder (directory) at the given absolute path, including any missing parent folders. Requires explicit user confirmation before it runs.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Absolute path of the folder to create.' },
    },
    required: ['path'],
  },
  requireConfirmation: true,
  async execute(args) {
    const path = typeof args.path === 'string' ? args.path : '';
    return fileOps.createFolder(path);
  },
};

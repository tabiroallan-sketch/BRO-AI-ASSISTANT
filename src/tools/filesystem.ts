import { dirname } from 'node:path';
import { mkdir, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import type { Tool } from './types.js';
import { ensureSandboxDir, resolveSandboxPath } from './sandbox.js';

const MAX_FILE_SIZE_BYTES = 100_000;

export const filesystemTool: Tool = {
  name: 'filesystem',
  description:
    'Read, write, list and delete files in the user\'s private sandbox directory. Operations: "read" (return file contents), "write" (create or overwrite a file), "list" (show directory contents) and "delete" (remove a file). Paths are relative to the user\'s sandbox root, e.g. "notes.txt" or "reports/jan.txt". Use this to save or retrieve persistent user files.',
  parameters: {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        description: 'One of: read, write, list, delete.',
      },
      path: {
        type: 'string',
        description: 'File or directory path relative to the user sandbox, e.g. "notes.txt".',
      },
      content: {
        type: 'string',
        description: 'File content to write (only used with the "write" operation).',
      },
    },
    required: ['operation', 'path'],
  },
  async execute(args, context) {
    const operation = typeof args.operation === 'string' ? args.operation : '';
    const rawPath = typeof args.path === 'string' ? args.path : '';

    if (operation === 'write') {
      const content = typeof args.content === 'string' ? args.content : '';
      const target = resolveSandboxPath(context.userId, rawPath);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content, 'utf8');
      const size = Buffer.byteLength(content, 'utf8');
      return `Wrote ${size} bytes to ${rawPath}.`;
    }

    if (operation === 'read') {
      const target = resolveSandboxPath(context.userId, rawPath);
      const info = await stat(target).catch(() => null);
      if (!info || !info.isFile()) {
        return `File not found: ${rawPath}`;
      }
      if (info.size > MAX_FILE_SIZE_BYTES) {
        return `File "${rawPath}" is too large to read (${info.size} bytes, max ${MAX_FILE_SIZE_BYTES}).`;
      }
      const content = await readFile(target, 'utf8');
      return content || '(empty file)';
    }

    if (operation === 'list') {
      ensureSandboxDir(context.userId);
      const target = resolveSandboxPath(context.userId, rawPath || '.');
      const info = await stat(target).catch(() => null);
      if (!info) {
        return `Path not found: ${rawPath}`;
      }
      if (!info.isDirectory()) {
        return `file ${rawPath || '.'} (${info.size} bytes)`;
      }
      const entries = await readdir(target, { withFileTypes: true });
      const lines = entries
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((entry) => `${entry.isDirectory() ? 'dir ' : 'file'} ${entry.name}`);
      return lines.length > 0 ? lines.join('\n') : '(empty directory)';
    }

    if (operation === 'delete') {
      const target = resolveSandboxPath(context.userId, rawPath);
      const info = await stat(target).catch(() => null);
      if (!info) {
        return `File not found: ${rawPath}`;
      }
      if (info.isDirectory()) {
        return `Cannot delete directory "${rawPath}" with the filesystem tool; delete files individually.`;
      }
      await unlink(target);
      return `Deleted ${rawPath}.`;
    }

    throw new Error(`Unknown filesystem operation "${operation}"`);
  },
};

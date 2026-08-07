import { mkdir, readdir, rename, stat } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import type { Runner } from './types.js';

export type FileEntry = {
  path: string;
  type: 'file' | 'dir';
};

export type FileOps = {
  searchFiles(
    query: string,
    options?: { root?: string; depth?: number; limit?: number },
  ): Promise<FileEntry[]>;
  renamePath(source: string, destination: string): Promise<string>;
  deletePath(path: string): Promise<string>;
  createFolder(path: string): Promise<string>;
};

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.hg',
  '.svn',
  'dist',
  'build',
  '.next',
  '.cache',
  '.turbo',
  'target',
]);

function toAbsolute(raw: string): string {
  const value = String(raw).trim();
  if (!value) {
    throw new Error('No path provided');
  }
  const resolved = resolve(value);
  if (!isAbsolute(resolved)) {
    throw new Error(`Invalid path "${value}"`);
  }
  return resolved;
}

export function createFileOps(
  runner: Runner,
  platform: NodeJS.Platform = process.platform,
  fs: { mkdir: typeof mkdir; readdir: typeof readdir; rename: typeof rename; stat: typeof stat } = {
    mkdir,
    readdir,
    rename,
    stat,
  },
): FileOps {
  const isWindows = platform === 'win32';

  function toBase64(value: string): string {
    return Buffer.from(value, 'utf8').toString('base64');
  }

  return {
    async searchFiles(query, options = {}) {
      const needle = String(query).trim().toLowerCase();
      if (!needle) {
        return [];
      }
      const root = options.root ? toAbsolute(options.root) : process.cwd();
      const depth = Math.min(Math.max(options.depth ?? 6, 1), 12);
      const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
      const matches: FileEntry[] = [];
      const rootInfo = await fs.stat(root).catch(() => null);
      if (!rootInfo || !rootInfo.isDirectory()) {
        throw new Error(`Search root not found or not a directory: ${root}`);
      }

      async function walk(dir: string, level: number): Promise<void> {
        if (matches.length >= limit) {
          return;
        }
        const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
        const sorted = entries.sort((a, b) => a.name.localeCompare(b.name));
        for (const entry of sorted) {
          if (matches.length >= limit) {
            return;
          }
          const fullPath = resolve(dir, entry.name);
          const isDir = entry.isDirectory();
          if (isDir && SKIP_DIRS.has(entry.name)) {
            continue;
          }
          if (entry.name.toLowerCase().includes(needle)) {
            matches.push({ path: fullPath, type: isDir ? 'dir' : 'file' });
          }
          if (isDir && level < depth) {
            await walk(fullPath, level + 1);
          }
        }
      }

      await walk(root, 1);
      return matches;
    },

    async renamePath(source, destination) {
      const from = toAbsolute(source);
      const to = toAbsolute(destination);
      if (from === to) {
        throw new Error('Source and destination are the same path');
      }
      const info = await fs.stat(from).catch(() => null);
      if (!info) {
        throw new Error(`Source not found: ${from}`);
      }
      await fs.mkdir(resolve(to, '..'), { recursive: true });
      await fs.rename(from, to);
      return `Moved "${from}" to "${to}".`;
    },

    async deletePath(path) {
      const target = toAbsolute(path);
      const info = await fs.stat(target).catch(() => null);
      if (!info) {
        throw new Error(`Path not found: ${target}`);
      }
      if (!isWindows) {
        throw new Error(
          'System delete is only supported on Windows (moves to the Recycle Bin). On other platforms use the sandboxed filesystem tool instead.',
        );
      }
      const method = info.isDirectory() ? 'DeleteDirectory' : 'DeleteFile';
      const encoded = toBase64(target);
      const script =
        `$p = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')); ` +
        `Add-Type -AssemblyName Microsoft.VisualBasic; ` +
        `[Microsoft.VisualBasic.FileIO.FileSystem]::${method}($p, 'OnlyErrorDialogs', 'SendToRecycleBin')`;
      const result = await runner.execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
        { timeoutMs: 20_000 },
      );
      if (result.code !== 0) {
        throw new Error(
          `Could not move "${target}" to the Recycle Bin: ${result.stderr.trim() || 'unknown error'}`,
        );
      }
      return `Moved "${target}" to the Recycle Bin.`;
    },

    async createFolder(path) {
      const target = toAbsolute(path);
      await fs.mkdir(target, { recursive: true });
      return `Created folder "${target}".`;
    },
  };
}

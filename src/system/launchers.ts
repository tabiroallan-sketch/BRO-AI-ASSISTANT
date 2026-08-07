import type { Runner } from './types.js';

export type LauncherOps = {
  openBrowser(url: string): Promise<string>;
  openEditor(path?: string): Promise<string>;
  openTerminal(path?: string): Promise<string>;
};

const URL_PATTERN = /^https?:\/\/\S+$/i;

export function createLauncherOps(
  runner: Runner,
  platform: NodeJS.Platform = process.platform,
): LauncherOps {
  const isWindows = platform === 'win32';
  const isMac = platform === 'darwin';

  return {
    async openBrowser(url): Promise<string> {
      const value = String(url).trim();
      if (!URL_PATTERN.test(value)) {
        throw new Error(`Invalid URL "${value}" (only http/https URLs can be opened)`);
      }
      let result;
      if (isWindows) {
        result = await runner.execFile('cmd.exe', ['/c', 'start', '', value], {
          timeoutMs: 10_000,
        });
      } else if (isMac) {
        result = await runner.execFile('open', [value], { timeoutMs: 10_000 });
      } else {
        result = await runner.execFile('xdg-open', [value], { timeoutMs: 10_000 });
      }
      if (result.code !== 0) {
        throw new Error(`Failed to open "${value}" in the browser`);
      }
      return `Opened ${value} in the default browser.`;
    },

    async openEditor(path): Promise<string> {
      const value = path ? String(path).trim() : undefined;
      const result = await runner.shell(value ? `code "${value}"` : 'code', {
        timeoutMs: 10_000,
      });
      if (result.code === 0) {
        return value ? `Opened ${value} in VS Code.` : 'Opened VS Code.';
      }
      if (isWindows) {
        const localAppData = process.env.LOCALAPPDATA ?? '';
        const fallback = `${localAppData}\\Programs\\Microsoft VS Code\\Code.exe`;
        const fallbackResult = await runner.execFile(fallback, value ? [value] : [], {
          timeoutMs: 10_000,
        });
        if (fallbackResult.code === 0) {
          return value ? `Opened ${value} in VS Code.` : 'Opened VS Code.';
        }
      }
      throw new Error(
        'VS Code does not appear to be installed (the "code" command was not found).',
      );
    },

    async openTerminal(path): Promise<string> {
      const value = path ? String(path).trim() : undefined;
      if (isWindows) {
        if (value) {
          const wt = await runner.execFile('wt.exe', ['-d', value], { timeoutMs: 10_000 });
          if (wt.code === 0) {
            return `Opened a terminal in ${value}.`;
          }
        }
        const args = value
          ? ['/c', 'start', 'cmd', '/k', `cd /d "${value}"`]
          : ['/c', 'start', 'cmd'];
        const result = await runner.execFile('cmd.exe', args, { timeoutMs: 10_000 });
        if (result.code !== 0) {
          throw new Error('Failed to open a terminal');
        }
        return value ? `Opened a terminal in ${value}.` : 'Opened a terminal.';
      }
      if (isMac) {
        const args = value ? ['-a', 'Terminal', value] : ['-a', 'Terminal'];
        const result = await runner.execFile('open', args, { timeoutMs: 10_000 });
        if (result.code !== 0) {
          throw new Error('Failed to open a terminal');
        }
        return value ? `Opened a terminal in ${value}.` : 'Opened a terminal.';
      }
      const term = process.env.TERMINAL ?? 'x-terminal-emulator';
      const result = await runner.execFile(term, value ? [value] : [], { timeoutMs: 10_000 });
      if (result.code !== 0) {
        throw new Error('Failed to open a terminal');
      }
      return value ? `Opened a terminal in ${value}.` : 'Opened a terminal.';
    },
  };
}

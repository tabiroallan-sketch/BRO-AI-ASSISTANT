import type { Runner } from './types.js';

export const CLIPBOARD_EMPTY_MARKER = '__BRO_CLIPBOARD_EMPTY__';
export const MAX_CLIPBOARD_READ_CHARS = 10_000;

export type ClipboardOps = {
  readOsClipboard(maxChars?: number): Promise<string>;
  writeOsClipboard(text: string): Promise<string>;
};

function toBase64(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64');
}

function fromBase64(value: string): string {
  return Buffer.from(value, 'base64').toString('utf8');
}

export function createClipboardOps(
  runner: Runner,
  platform: NodeJS.Platform = process.platform,
): ClipboardOps {
  const isWindows = platform === 'win32';
  const isMac = platform === 'darwin';

  return {
    async readOsClipboard(maxChars = MAX_CLIPBOARD_READ_CHARS): Promise<string> {
      if (isWindows) {
        const script =
          `$c = Get-Clipboard -Raw -ErrorAction SilentlyContinue; ` +
          `if ($null -eq $c -or $c -eq '') { '${CLIPBOARD_EMPTY_MARKER}' } else { ` +
          `[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$c)) }`;
        const result = await runner.execFile(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
          { timeoutMs: 10_000 },
        );
        if (result.code !== 0) {
          throw new Error(`Failed to read the clipboard: ${result.stderr.trim()}`);
        }
        const output = result.stdout.trim();
        if (output === CLIPBOARD_EMPTY_MARKER || output === '') {
          return 'The OS clipboard is empty.';
        }
        const text = fromBase64(output);
        const clamped = Math.min(Math.max(Math.floor(maxChars), 1), MAX_CLIPBOARD_READ_CHARS);
        return text.length > clamped ? `${text.slice(0, clamped)}… (clipped)` : text;
      }
      if (isMac) {
        const result = await runner.execFile('pbpaste', [], { timeoutMs: 10_000 });
        if (result.code !== 0) {
          throw new Error('Failed to read the clipboard.');
        }
        const text = result.stdout.trim();
        return text === '' ? 'The OS clipboard is empty.' : text;
      }
      const result = await runner.execFile('wl-paste', [], { timeoutMs: 10_000 });
      if (result.code !== 0) {
        throw new Error('Failed to read the clipboard (wl-paste unavailable).');
      }
      const text = result.stdout.trim();
      return text === '' ? 'The OS clipboard is empty.' : text;
    },

    async writeOsClipboard(text: string): Promise<string> {
      const value = String(text);
      if (value.length > 50_000) {
        throw new Error('Text is too long to copy to the OS clipboard');
      }
      const encoded = toBase64(value);
      if (isWindows) {
        const script =
          `$t = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')); ` +
          `Set-Clipboard -Value $t`;
        const result = await runner.execFile(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
          { timeoutMs: 10_000 },
        );
        if (result.code !== 0) {
          throw new Error(`Failed to write the clipboard: ${result.stderr.trim()}`);
        }
        return `Copied ${value.length} characters to the OS clipboard.`;
      }
      const command = isMac
        ? `printf '%s' '${encoded}' | base64 --decode | pbcopy`
        : `printf '%s' '${encoded}' | base64 --decode | wl-copy`;
      const result = await runner.shell(command, { timeoutMs: 10_000 });
      if (result.code !== 0) {
        throw new Error(
          `Failed to write the clipboard (${result.stderr.trim() || 'unknown error'})`,
        );
      }
      return `Copied ${value.length} characters to the OS clipboard.`;
    },
  };
}

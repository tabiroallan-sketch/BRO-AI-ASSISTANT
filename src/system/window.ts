import type { Runner } from './types.js';

export type WindowInfo = {
  id: number;
  process: string;
  title: string;
};

export type WindowTarget = {
  id?: number;
  title?: string;
};

export type WindowOps = {
  listWindows(): Promise<WindowInfo[]>;
  focusWindow(target: WindowTarget): Promise<string>;
  minimizeWindow(target: WindowTarget): Promise<string>;
};

const USER32_SCRIPT =
  'Add-Type @"\n' +
  'using System;\n' +
  'using System.Runtime.InteropServices;\n' +
  'public class Win32 {\n' +
  '  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);\n' +
  '  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);\n' +
  '}\n' +
  '"@; ';

function buildSelector(target: WindowTarget): { byId: boolean; value: string } {
  if (typeof target.id === 'number' && target.id > 0) {
    return { byId: true, value: String(Math.floor(target.id)) };
  }
  if (typeof target.title === 'string' && target.title.trim()) {
    return { byId: false, value: target.title.trim() };
  }
  throw new Error('Specify a window id or title to target a window');
}

function processRows(rows: unknown): WindowInfo[] {
  const list = Array.isArray(rows) ? rows : [rows];
  return list
    .filter((row): row is Record<string, unknown> => row !== null && typeof row === 'object')
    .map((row) => ({
      id: Number(row.Id) || 0,
      process: String(row.ProcessName ?? ''),
      title: String(row.MainWindowTitle ?? ''),
    }))
    .filter((window) => window.id > 0 && window.title.length > 0);
}

export function createWindowOps(
  runner: Runner,
  platform: NodeJS.Platform = process.platform,
): WindowOps {
  const isWindows = platform === 'win32';

  async function powershell(
    script: string,
  ): Promise<{ code: number; stdout: string; stderr: string }> {
    return runner.execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { timeoutMs: 20_000 },
    );
  }

  return {
    async listWindows(): Promise<WindowInfo[]> {
      if (!isWindows) {
        return [];
      }
      const result = await powershell(
        'Get-Process | Where-Object { $_.MainWindowTitle } | ' +
          'Select-Object Id, ProcessName, MainWindowTitle | ConvertTo-Json -Compress',
      );
      if (result.code !== 0 || !result.stdout.trim()) {
        return [];
      }
      try {
        return processRows(JSON.parse(result.stdout));
      } catch {
        return [];
      }
    },

    async focusWindow(target: WindowTarget): Promise<string> {
      if (!isWindows) {
        throw new Error('Window management is only supported on Windows');
      }
      const { byId, value } = buildSelector(target);
      const getHandle = byId
        ? `$p = Get-Process -Id ${value} -ErrorAction SilentlyContinue`
        : `$p = Get-Process | Where-Object { $_.MainWindowTitle -eq '${value}' } | Select-Object -First 1`;
      const script =
        USER32_SCRIPT +
        `${getHandle}; if ($p -and $p.MainWindowHandle -ne 0) { ` +
        `[void][Win32]::SetForegroundWindow($p.MainWindowHandle); 'focused' } else { 'not found' }`;
      const result = await powershell(script);
      if (result.stdout.trim() === 'focused') {
        return byId ? `Focused the window (id ${value}).` : `Focused the window titled "${value}".`;
      }
      throw new Error(
        byId ? `No window found with id ${value}` : `No window found with title "${value}"`,
      );
    },

    async minimizeWindow(target: WindowTarget): Promise<string> {
      if (!isWindows) {
        throw new Error('Window management is only supported on Windows');
      }
      const { byId, value } = buildSelector(target);
      const getHandle = byId
        ? `$p = Get-Process -Id ${value} -ErrorAction SilentlyContinue`
        : `$p = Get-Process | Where-Object { $_.MainWindowTitle -eq '${value}' } | Select-Object -First 1`;
      const script =
        USER32_SCRIPT +
        `${getHandle}; if ($p -and $p.MainWindowHandle -ne 0) { ` +
        `[void][Win32]::ShowWindow($p.MainWindowHandle, 6); 'minimized' } else { 'not found' }`;
      const result = await powershell(script);
      if (result.stdout.trim() === 'minimized') {
        return byId
          ? `Minimized the window (id ${value}).`
          : `Minimized the window titled "${value}".`;
      }
      throw new Error(
        byId ? `No window found with id ${value}` : `No window found with title "${value}"`,
      );
    },
  };
}

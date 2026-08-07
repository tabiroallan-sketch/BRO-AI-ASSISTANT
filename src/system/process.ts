import type { ExecOptions, Runner } from './types.js';
import { MAX_OUTPUT_CHARS, PROCESS_NAME_PATTERN, SCRIPT_NAME_PATTERN } from './types.js';

export type ProcessInfo = {
  id: number;
  name: string;
  windowTitle: string | null;
};

export type ProcessOps = {
  listProcesses(limit?: number): Promise<{ processes: ProcessInfo[]; source: string }>;
  launchApp(target: string): Promise<string>;
  terminateApp(name: string, force?: boolean): Promise<string>;
  runShellCommand(command: string, options?: ExecOptions): Promise<string>;
  runScript(runtime: 'npm' | 'bun', script: string, options?: ExecOptions): Promise<string>;
};

function truncate(text: string): string {
  if (text.length <= MAX_OUTPUT_CHARS) {
    return text;
  }
  return `${text.slice(0, MAX_OUTPUT_CHARS)}\n... (output truncated)`;
}

function describeResult(code: number, stdout: string, stderr: string): string {
  const body = stdout.trim() || stderr.trim() || '(no output)';
  return code === 0 ? body : `Command finished with exit code ${code}:\n${body}`;
}

export function createProcessOps(
  runner: Runner,
  platform: NodeJS.Platform = process.platform,
): ProcessOps {
  const isWindows = platform === 'win32';
  const isMac = platform === 'darwin';

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
    async listProcesses(limit = 50): Promise<{ processes: ProcessInfo[]; source: string }> {
      if (!isWindows) {
        return { processes: [], source: 'unsupported' };
      }
      const clamped = Math.min(Math.max(Math.floor(limit), 1), 200);
      const result = await powershell(
        `Get-Process | Sort-Object ProcessName | Select-Object -First ${clamped} Id, ProcessName, MainWindowTitle | ConvertTo-Json -Compress`,
      );
      if (result.code !== 0 || !result.stdout.trim()) {
        return { processes: [], source: 'windows' };
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(result.stdout);
      } catch {
        return { processes: [], source: 'windows' };
      }
      const rows = Array.isArray(parsed) ? parsed : [parsed];
      const processes = rows
        .filter((row): row is Record<string, unknown> => row !== null && typeof row === 'object')
        .map((row) => ({
          id: Number(row.Id) || 0,
          name: String(row.ProcessName ?? ''),
          windowTitle: row.MainWindowTitle ? String(row.MainWindowTitle) : null,
        }))
        .filter((process) => process.name.length > 0);
      return { processes, source: 'windows' };
    },

    async launchApp(target: string): Promise<string> {
      const value = String(target).trim();
      if (!value) {
        throw new Error('No application specified');
      }
      if (isWindows) {
        const result = await runner.execFile('cmd.exe', ['/c', 'start', '', value], {
          timeoutMs: 10_000,
        });
        if (result.code !== 0) {
          throw new Error(
            `Failed to launch "${value}": ${result.stderr.trim() || 'unknown error'}`,
          );
        }
        return `Launched ${value}.`;
      }
      if (isMac) {
        const result = await runner.execFile('open', [value], { timeoutMs: 10_000 });
        if (result.code !== 0) {
          throw new Error(`Failed to launch "${value}"`);
        }
        return `Launched ${value}.`;
      }
      const result = await runner.execFile('xdg-open', [value], { timeoutMs: 10_000 });
      if (result.code !== 0) {
        throw new Error(`Failed to launch "${value}"`);
      }
      return `Launched ${value}.`;
    },

    async terminateApp(name: string, force = false): Promise<string> {
      const value = String(name).trim();
      if (!PROCESS_NAME_PATTERN.test(value)) {
        throw new Error(`Invalid process name "${value}"`);
      }
      const lower = value.toLowerCase();
      const protectedProcesses = new Set([
        'node.exe',
        'taskkill.exe',
        'powershell.exe',
        'pwsh.exe',
        'cmd.exe',
        'conhost.exe',
        'wininit.exe',
        'services.exe',
        'csrss.exe',
        'lsass.exe',
        'smss.exe',
        'system.exe',
        'explorer.exe',
      ]);
      if (protectedProcesses.has(lower)) {
        throw new Error(`Refusing to terminate protected process "${value}"`);
      }
      if (isWindows) {
        const args = ['/IM', value, '/T', ...(force ? ['/F'] : [])];
        const result = await runner.execFile('taskkill.exe', args, { timeoutMs: 10_000 });
        if (result.code !== 0) {
          throw new Error(
            `Could not terminate "${value}" (taskkill exit ${result.code}): ${result.stderr.trim()}`,
          );
        }
        return `Terminated ${value}.`;
      }
      const result = await runner.execFile('pkill', [force ? '-9' : '-15', value], {
        timeoutMs: 10_000,
      });
      if (result.code !== 0) {
        throw new Error(`Could not terminate "${value}" (pkill exit ${result.code})`);
      }
      return `Terminated ${value}.`;
    },

    async runShellCommand(command: string, options?: ExecOptions): Promise<string> {
      const value = String(command).trim();
      if (!value) {
        throw new Error('No command provided');
      }
      if (value.length > 2_000) {
        throw new Error('Command is too long');
      }
      const result = await runner.shell(value, { timeoutMs: 30_000, ...options });
      return truncate(describeResult(result.code, result.stdout, result.stderr));
    },

    async runScript(
      runtime: 'npm' | 'bun',
      script: string,
      options?: ExecOptions,
    ): Promise<string> {
      if (runtime !== 'npm' && runtime !== 'bun') {
        throw new Error(`Unsupported script runtime "${runtime}"`);
      }
      const value = String(script).trim();
      if (!SCRIPT_NAME_PATTERN.test(value)) {
        throw new Error(`Invalid script name "${value}"`);
      }
      const command = `${runtime} run ${value}`;
      const result = await runner.shell(command, {
        timeoutMs: 60_000,
        ...options,
      });
      return truncate(describeResult(result.code, result.stdout, result.stderr));
    },
  };
}

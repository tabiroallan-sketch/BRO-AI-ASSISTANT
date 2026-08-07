import { exec as cpExec, execFile as cpExecFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ExecOptions, ExecResult, Runner } from './types.js';

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_BUFFER_BYTES = 2 * 1024 * 1024;

type ExecError = {
  code?: number | string;
  killed?: boolean;
  stdout?: string | Buffer;
  stderr?: string | Buffer;
};

function normalize(result: { stdout: string | Buffer; stderr: string | Buffer }): ExecResult {
  return { code: 0, stdout: String(result.stdout), stderr: String(result.stderr) };
}

function errorCode(error: ExecError): number {
  if (error.killed) {
    return 124;
  }
  if (typeof error.code === 'number') {
    return error.code;
  }
  if (typeof error.code === 'string') {
    return error.code === 'ENOENT' ? 127 : 1;
  }
  return 1;
}

function errorResult(error: ExecError): ExecResult {
  return {
    code: errorCode(error),
    stdout: String(error.stdout ?? ''),
    stderr: String(error.stderr ?? ''),
  };
}

const execFileAsync = promisify(cpExecFile);
const execAsync = promisify(cpExec);

export function createRunner(options: { defaultTimeoutMs?: number } = {}): Runner {
  const defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  return {
    async execFile(file, args, execOptions?: ExecOptions): Promise<ExecResult> {
      try {
        const result = await execFileAsync(file, args, {
          cwd: execOptions?.cwd,
          timeout: execOptions?.timeoutMs ?? defaultTimeoutMs,
          windowsHide: true,
          maxBuffer: MAX_BUFFER_BYTES,
        });
        return normalize(result);
      } catch (error) {
        return errorResult(error as ExecError);
      }
    },
    async shell(command, execOptions?: ExecOptions): Promise<ExecResult> {
      try {
        const result = await execAsync(command, {
          cwd: execOptions?.cwd,
          timeout: execOptions?.timeoutMs ?? defaultTimeoutMs,
          windowsHide: true,
          maxBuffer: MAX_BUFFER_BYTES,
        });
        return normalize(result);
      } catch (error) {
        return errorResult(error as ExecError);
      }
    },
  };
}

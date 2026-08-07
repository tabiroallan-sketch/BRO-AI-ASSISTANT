export type ExecResult = {
  code: number;
  stdout: string;
  stderr: string;
};

export type ExecOptions = {
  cwd?: string;
  timeoutMs?: number;
};

/**
 * The single seam between system operations and the real OS. Real
 * implementations use node:child_process; tests inject a fake runner so the
 * whole system layer can be unit-tested without touching the machine.
 */
export interface Runner {
  /** Run an executable with an argument array (no shell interpretation). */
  execFile(file: string, args: string[], options?: ExecOptions): Promise<ExecResult>;
  /** Run a command string through the platform shell. */
  shell(command: string, options?: ExecOptions): Promise<ExecResult>;
}

export const SCRIPT_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9:_-]*$/;
export const PROCESS_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*\.(exe|com|bat|cmd)$/i;

/** Output cap applied to any command result before it reaches the model. */
export const MAX_OUTPUT_CHARS = 8_000;

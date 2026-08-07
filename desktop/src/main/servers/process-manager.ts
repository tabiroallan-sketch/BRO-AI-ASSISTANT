import { spawn, type ChildProcess } from 'node:child_process';
import type { ServiceState } from '../../shared/desktop-api.js';

export type SpawnFn = typeof spawn;

export type HealthProbe = () => Promise<boolean>;

export type ManagedProcessOptions = {
  /** Human-readable label used in logs and reports. */
  label: string;
  /** Executable to run. */
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string | undefined>;
  /**
   * When true the Electron binary is launched in plain-Node mode
   * (ELECTRON_RUN_AS_NODE=1) so no external Node installation is needed.
   */
  runAsNode?: boolean;
  /** Optional readiness probe; without it the process is "running" once spawned. */
  health?: HealthProbe;
  /** How long to keep probing before declaring the start a failure (ms). */
  startTimeoutMs?: number;
  /** Interval between readiness probes (ms). */
  healthPollMs?: number;
  /** Max restarts before the crash-loop breaker trips. */
  maxRestarts?: number;
  /** Restarts within this window count toward the breaker (ms). */
  restartWindowMs?: number;
  /** Backoff base for restart delays (ms); delays grow exponentially. */
  backoffMs?: number;
  /** Overridable for tests. */
  spawnFn?: SpawnFn;
  onLog?: (line: string) => void;
};

export type ManagedProcess = {
  readonly label: string;
  getState(): ServiceState;
  getExitCode(): number | null;
  start(): Promise<void>;
  stop(): Promise<void>;
  restart(reason?: string): Promise<void>;
  onStateChange(callback: (state: ServiceState, message?: string) => void): () => void;
};

const MAX_RESTARTS_DEFAULT = 5;
const RESTART_WINDOW_MS = 60_000;
const BACKOFF_MS = 500;

export function createManagedProcess(options: ManagedProcessOptions): ManagedProcess {
  const spawnFn = options.spawnFn ?? spawn;
  const maxRestarts = options.maxRestarts ?? MAX_RESTARTS_DEFAULT;
  const restartWindowMs = options.restartWindowMs ?? RESTART_WINDOW_MS;
  const backoffMs = options.backoffMs ?? BACKOFF_MS;
  const startTimeoutMs = options.startTimeoutMs ?? 30_000;
  const healthPollMs = options.healthPollMs ?? 500;

  let child: ChildProcess | null = null;
  let state: ServiceState = 'stopped';
  let exitCode: number | null = null;
  let stopping = false;
  let restartScheduled = false;
  let restartTimer: ReturnType<typeof setTimeout> | null = null;
  let healthTimer: ReturnType<typeof setInterval> | null = null;
  let startDeadline: ReturnType<typeof setTimeout> | null = null;
  let restarts: number[] = [];
  let restartAttempt = 0;

  const listeners = new Set<(state: ServiceState, message?: string) => void>();

  function setState(next: ServiceState, reason?: string): void {
    state = next;
    for (const listener of listeners) {
      listener(next, reason);
    }
  }

  function pruneRestartWindow(now: number): void {
    restarts = restarts.filter((time) => now - time < restartWindowMs);
  }

  async function start(): Promise<void> {
    const isScheduledRestart = restartScheduled;
    restartScheduled = false;
    if (!isScheduledRestart && (state === 'starting' || state === 'running')) {
      return;
    }
    exitCode = null;
    stopping = false;
    setState('starting');
    try {
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        ...options.env,
        ...(options.runAsNode ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
      };
      const spawned = spawnFn(options.command, options.args, {
        cwd: options.cwd,
        env,
        windowsHide: true,
      });
      child = spawned;
      spawned.on('exit', (code, signal) => {
        if (child !== spawned) {
          // A superseded child: replaced by a newer spawn or abandoned during
          // error cleanup. Its exit must not drive restart logic.
          return;
        }
        child = null;
        exitCode = code;
        clearTimers();
        if (stopping) {
          setState('stopped');
          return;
        }
        handleUnexpectedExit(code, signal);
      });
      spawned.on('error', (error) => {
        setState('error', error.message);
      });
      spawned.stdout?.on('data', (chunk: Buffer) => emitLog(chunk));
      spawned.stderr?.on('data', (chunk: Buffer) => emitLog(chunk));
      await waitUntilReady();
      setState('running');
    } catch (error) {
      setState('error', error instanceof Error ? error.message : String(error));
      if (child) {
        const dying = child;
        child = null;
        dying.kill();
      }
    }
  }

  function emitLog(chunk: Buffer): void {
    const text = chunk.toString('utf8').replace(/\n$/, '');
    if (text.trim()) {
      options.onLog?.(text);
    }
  }

  async function waitUntilReady(): Promise<void> {
    if (!options.health) {
      return;
    }
    const deadline = Date.now() + startTimeoutMs;
    await new Promise<void>((resolve, reject) => {
      const poll = async (): Promise<void> => {
        if (!child) {
          reject(new Error('Process exited before it became ready'));
          return;
        }
        try {
          if (await options.health?.()) {
            resolve();
            return;
          }
        } catch {
          // keep probing
        }
        if (Date.now() >= deadline) {
          reject(new Error('Process did not become ready in time'));
          return;
        }
        setTimeout(() => void poll(), healthPollMs);
      };
      void poll();
    });
  }

  function handleUnexpectedExit(code: number | null, _signal: string | null): void {
    pruneRestartWindow(Date.now());
    if (restarts.length >= maxRestarts) {
      setState('error', `Crashed repeatedly (last exit code ${code ?? 'unknown'})`);
      return;
    }
    restarts.push(Date.now());
    restartAttempt += 1;
    const delay = Math.min(backoffMs * 2 ** (restartAttempt - 1), 10_000);
    restartScheduled = true;
    setState('starting', `Restarting in ${delay}ms`);
    restartTimer = setTimeout(() => {
      void start().catch(() => {
        // state already updated by start()
      });
    }, delay);
  }

  function clearTimers(): void {
    restartScheduled = false;
    if (restartTimer) {
      clearTimeout(restartTimer);
      restartTimer = null;
    }
    if (healthTimer) {
      clearInterval(healthTimer);
      healthTimer = null;
    }
    if (startDeadline) {
      clearTimeout(startDeadline);
      startDeadline = null;
    }
  }

  async function stop(): Promise<void> {
    stopping = true;
    clearTimers();
    const current = child;
    if (!current || current.exitCode !== null) {
      setState('stopped');
      return;
    }
    await new Promise<void>((resolve) => {
      const force = setTimeout(() => {
        current.kill('SIGKILL');
      }, 10_000);
      current.once('exit', () => {
        clearTimeout(force);
        resolve();
      });
      try {
        current.kill('SIGTERM');
      } catch {
        current.kill('SIGKILL');
      }
    });
    setState('stopped');
  }

  function getState(): ServiceState {
    return state;
  }

  function getExitCode(): number | null {
    return exitCode;
  }

  async function restart(_reason?: string): Promise<void> {
    await stop();
    restartAttempt = 0;
    await start();
  }

  function onStateChange(callback: (state: ServiceState, message?: string) => void): () => void {
    listeners.add(callback);
    return () => {
      listeners.delete(callback);
    };
  }

  return {
    label: options.label,
    getState,
    getExitCode,
    start,
    stop,
    restart,
    onStateChange,
  };
}

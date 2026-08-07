import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { app } from 'electron';
import type { MainWindow } from './windows.js';

export type CrashGuardOptions = {
  logFile: string;
};

const MAX_RELOAD_ATTEMPTS = 3;
const RELOAD_WINDOW_MS = 30_000;

/**
 * Crash recovery: keeps the shell alive when the main process hits an
 * unhandled error, reloads a crashed renderer (with a circuit breaker so a
 * failing page cannot spin), and logs everything to a crash log in userData.
 * Child-process crashes (API/web) are handled by the ServerManager watchdog.
 */
export class CrashGuard {
  private readonly options: CrashGuardOptions;
  private reloadAttempts: number[] = [];

  constructor(options: CrashGuardOptions) {
    this.options = options;
  }

  init(getWindow: () => MainWindow | null): void {
    process.on('uncaughtException', (error) => this.record('uncaughtException', error));
    process.on('unhandledRejection', (reason) => this.record('unhandledRejection', reason));
    app.on('child-process-gone', (_event, details) => {
      this.record('child-process-gone', new Error(JSON.stringify(details)));
    });

    app.on('web-contents-created', (_event, contents) => {
      contents.on('render-process-gone', (_event, details) => {
        this.record('render-process-gone', new Error(JSON.stringify(details)));
        const now = Date.now();
        this.reloadAttempts = this.reloadAttempts.filter((time) => now - time < RELOAD_WINDOW_MS);
        this.reloadAttempts.push(now);
        if (this.reloadAttempts.length > MAX_RELOAD_ATTEMPTS) {
          this.record('render-process-gone', new Error('reload circuit breaker tripped'));
          return;
        }
        const window = getWindow();
        const contentsHost = window?.instance?.webContents;
        if (contentsHost && !contentsHost.isDestroyed() && contentsHost.id === contents.id) {
          window?.instance?.webContents.reload();
        }
      });
    });
  }

  private record(event: string, error: unknown): void {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    const line = `[${new Date().toISOString()}] ${event}: ${message}\n`;
    try {
      mkdirSync(dirname(this.options.logFile), { recursive: true });
      appendFileSync(this.options.logFile, line, 'utf8');
    } catch {
      // Never let crash logging take the app down.
    }
  }
}

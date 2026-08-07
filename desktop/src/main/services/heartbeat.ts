import type { ServerReport, ServiceId } from '../../shared/desktop-api.js';
import { BackgroundScheduler } from './scheduler.js';

export type HeartbeatReport = {
  timestamp: number;
  /** Milliseconds since the process started. */
  uptimeMs: number;
  memory: { heapUsed: number; rss: number };
  services: ServerReport[];
  /** Services the heartbeat had to restart this cycle. */
  restarted: ServiceId[];
};

export type HeartbeatOptions = {
  /** How often to run while the window is visible. */
  intervalMs?: number;
  /** Throttled interval while the window is hidden (low CPU in background). */
  backgroundIntervalMs?: number;
  /** Cooldown between restart attempts per service (crash-loop guard). */
  cooldownMs?: number;
  /** True while the main window is hidden to the tray. */
  isBackground: () => boolean;
  /** True once shutdown has begun - no recovery work is attempted. */
  shouldPause: () => boolean;
  getReports: () => ServerReport[];
  /** Liveness check beyond the reported state (Postgres is TCP-probed). */
  isServiceAlive: (id: ServiceId) => Promise<boolean>;
  /** Restarts a service that is expected to be running. */
  restartService: (id: ServiceId) => Promise<void>;
  onTick?: (report: HeartbeatReport) => void;
  onLog?: (line: string) => void;
  /** Injectable for tests. */
  scheduler?: BackgroundScheduler;
};

const DEFAULT_INTERVAL_MS = 60_000;
const DEFAULT_BACKGROUND_INTERVAL_MS = 300_000;
const DEFAULT_COOLDOWN_MS = 60_000;

/**
 * Keeps the background services alive while the app is hidden to the tray.
 * Each cycle: reports service states, verifies liveness, and restarts any
 * service that is down - with a per-service cooldown so a broken Postgres or
 * API cannot trigger a restart loop. Emits a heartbeat report (uptime, memory,
 * restarts) for monitoring.
 */
export class Heartbeat {
  private readonly options: HeartbeatOptions;
  private readonly scheduler: BackgroundScheduler;
  private readonly lastRestartAt = new Map<ServiceId, number>();
  private readonly intervalMs: number;
  private readonly backgroundIntervalMs: number;
  private readonly cooldownMs: number;

  constructor(options: HeartbeatOptions) {
    this.options = options;
    this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.backgroundIntervalMs = options.backgroundIntervalMs ?? DEFAULT_BACKGROUND_INTERVAL_MS;
    this.cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS;
    this.scheduler = options.scheduler ?? new BackgroundScheduler({ onError: this.onError });
    this.scheduler.register({
      id: 'heartbeat',
      intervalMs: () => (options.isBackground() ? this.backgroundIntervalMs : this.intervalMs),
      unref: true,
      run: () => void this.tick(),
    });
  }

  start(): void {
    this.scheduler.start();
  }

  stop(): void {
    this.scheduler.stop();
  }

  /** Runs one full heartbeat cycle and returns the report. */
  async tick(): Promise<HeartbeatReport> {
    if (this.options.shouldPause()) {
      return this.emptyReport();
    }
    const reports = this.options.getReports();
    const restarted: ServiceId[] = [];
    for (const report of reports) {
      if (await this.isDown(report)) {
        const restarting = await this.tryRestart(report.id);
        if (restarting) {
          restarted.push(report.id);
        }
      }
    }
    const report: HeartbeatReport = {
      timestamp: Date.now(),
      uptimeMs: Math.round(process.uptime() * 1000),
      memory: {
        heapUsed: process.memoryUsage().heapUsed,
        rss: process.memoryUsage().rss,
      },
      services: reports,
      restarted,
    };
    this.options.onTick?.(report);
    return report;
  }

  private async isDown(report: ServerReport): Promise<boolean> {
    if (report.state === 'stopped' || report.state === 'error') {
      return true;
    }
    if (report.state === 'starting') {
      return false;
    }
    // A "running" service is double-checked with a liveness probe. This is
    // cheap for the managed children (state is authoritative) and catches a
    // dead Postgres, whose state is not tracked by this shell.
    return !(await this.options.isServiceAlive(report.id));
  }

  private async tryRestart(id: ServiceId): Promise<boolean> {
    const now = Date.now();
    const last = this.lastRestartAt.get(id) ?? 0;
    if (now - last < this.cooldownMs) {
      return false;
    }
    this.lastRestartAt.set(id, now);
    this.options.onLog?.(`heartbeat: restarting ${id}`);
    try {
      await this.options.restartService(id);
      return true;
    } catch (error) {
      this.options.onLog?.(
        `heartbeat: restart of ${id} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  private emptyReport(): HeartbeatReport {
    return {
      timestamp: Date.now(),
      uptimeMs: Math.round(process.uptime() * 1000),
      memory: {
        heapUsed: process.memoryUsage().heapUsed,
        rss: process.memoryUsage().rss,
      },
      services: this.options.getReports(),
      restarted: [],
    };
  }

  private readonly onError = (taskId: string, error: unknown): void => {
    this.options.onLog?.(
      `heartbeat: ${taskId} failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  };
}

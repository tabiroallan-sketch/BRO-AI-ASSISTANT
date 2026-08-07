export type ConnectivityMonitorOptions = {
  probe: () => Promise<boolean>;
  intervalMs?: number;
  onStatus: (online: boolean) => void;
};

/**
 * Detects whether the API is reachable. Unlike the browser's navigator.onLine
 * (which only reflects the network link), this actually probes the local API
 * so the app can distinguish "no internet" from "BRO is down". Stage 11
 * extends this into the proactive notification system.
 */
export class ConnectivityMonitor {
  private readonly options: ConnectivityMonitorOptions;
  private timer: ReturnType<typeof setInterval> | null = null;
  private online = false;

  constructor(options: ConnectivityMonitorOptions) {
    this.options = options;
  }

  async check(): Promise<boolean> {
    try {
      this.online = await this.options.probe();
    } catch {
      this.online = false;
    }
    this.options.onStatus(this.online);
    return this.online;
  }

  /** Current known state without probing. */
  get onlineState(): boolean {
    return this.online;
  }

  start(): void {
    if (this.timer) {
      return;
    }
    void this.check();
    const interval = this.options.intervalMs ?? 15_000;
    this.timer = setInterval(() => {
      void this.check();
    }, interval);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

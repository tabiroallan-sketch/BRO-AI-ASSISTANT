import type { DesktopConfig, ServerReport, ServiceId } from '../../shared/desktop-api.js';
import type { SpawnFn, ManagedProcess } from './process-manager.js';
import { createApiServer, type ApiServerOptions, type RuntimeSecrets } from './api-server.js';
import { createWebServer, type WebServerOptions } from './web-server.js';
import {
  PostgresServer,
  type PostgresLike,
  type PostgresServerOptions,
} from './postgres-server.js';
import { runMigrations, type MigrateOptions } from './migrate.js';
import { getFreePort } from '../ports.js';

type Service = ManagedProcess;

export type ServerManagerOptions = {
  apiDir: string;
  webDir: string;
  dataDir: string;
  postgresDir: string;
  secrets: RuntimeSecrets;
  /** Resolves the current desktop config (for browserEnabled etc.). */
  getConfig: () => Promise<DesktopConfig>;
  /** Executable used to launch child servers. */
  nodeCommand: string;
  /** Launch children as plain Node via ELECTRON_RUN_AS_NODE. */
  runAsNode: boolean;
  /** Preferred ports; falls back to free ports when occupied. */
  preferred?: { postgres?: number; api?: number; web?: number };
  spawnFn?: SpawnFn;
  onLog?: (line: string) => void;
  /** Test seam: override the Postgres provider. */
  postgresFactory?: (options: PostgresServerOptions) => PostgresLike;
  /** Test seam: override the migration runner. */
  migrationsFn?: (options: MigrateOptions) => Promise<void>;
  /** Test seam: override API/web service construction. */
  apiFactory?: (options: ApiServerOptions) => ManagedProcess;
  webFactory?: (options: WebServerOptions) => ManagedProcess;
};

export type RuntimeUrls = { apiUrl: string; webUrl: string };

/**
 * Owns the lifecycle of the three embedded services (Postgres, API, web).
 * Ordering matters: Postgres → migrations → API → web. The web UI is the last
 * thing to come up, so the window is only created once it can render.
 */
export class ServerManager {
  private postgres: PostgresLike | null = null;
  private api: Service | null = null;
  private web: Service | null = null;
  private apiPort = 0;
  private webPort = 0;
  private readonly options: ServerManagerOptions;
  private readonly listeners = new Set<(reports: ServerReport[]) => void>();

  constructor(options: ServerManagerOptions) {
    this.options = options;
  }

  getPorts(): { api: number; web: number; postgres: number } {
    const postgres = this.postgres?.getPort() ?? 0;
    return { api: this.apiPort, web: this.webPort, postgres };
  }

  getApiUrl(): string {
    return `http://127.0.0.1:${this.apiPort}`;
  }

  getWebUrl(): string {
    return `http://127.0.0.1:${this.webPort}`;
  }

  onStatus(callback: (reports: ServerReport[]) => void): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  getReports(): ServerReport[] {
    const reports: ServerReport[] = [];
    if (this.postgres) {
      reports.push({
        id: 'postgres',
        state: this.postgres.getState(),
        port: this.postgres.getPort(),
      });
    }
    if (this.api) {
      reports.push({ id: 'api', state: this.api.getState(), port: this.apiPort });
    }
    if (this.web) {
      reports.push({ id: 'web', state: this.web.getState(), port: this.webPort });
    }
    return reports;
  }

  private wire(service: Service): void {
    service.onStateChange(() => this.publish());
  }

  private publish(): void {
    const reports = this.getReports();
    for (const listener of this.listeners) {
      listener(reports);
    }
  }

  async startAll(): Promise<RuntimeUrls> {
    const { dataDir, preferred, apiDir, webDir, secrets, nodeCommand, runAsNode } = this.options;
    const config = await this.options.getConfig();

    const postgresPort = preferred?.postgres ?? (await getFreePort(5432));
    this.apiPort = preferred?.api ?? (await getFreePort(3000));
    this.webPort = preferred?.web ?? (await getFreePort(3001));

    this.postgres = this.options.postgresFactory
      ? this.options.postgresFactory({ databaseDir: this.options.postgresDir, port: postgresPort })
      : new PostgresServer({ databaseDir: this.options.postgresDir, port: postgresPort });
    await this.postgres.start();
    this.publish();

    const databaseUrl = this.postgres.connectionUri();
    const migrations = this.options.migrationsFn ?? runMigrations;
    await migrations({ apiDir, databaseUrl, nodeCommand, runAsNode });

    this.api = this.options.apiFactory
      ? this.options.apiFactory({
          apiDir,
          dataDir,
          port: this.apiPort,
          databaseUrl,
          webOrigin: `http://127.0.0.1:${this.webPort}`,
          browserEnabled: config.browserEnabled,
          secrets,
          nodeCommand,
          runAsNode,
          spawnFn: this.options.spawnFn,
          onLog: this.options.onLog,
        })
      : createApiServer({
          apiDir,
          dataDir,
          port: this.apiPort,
          databaseUrl,
          webOrigin: `http://127.0.0.1:${this.webPort}`,
          browserEnabled: config.browserEnabled,
          secrets,
          nodeCommand,
          runAsNode,
          spawnFn: this.options.spawnFn,
          onLog: this.options.onLog,
        });
    this.wire(this.api);
    await this.api.start();
    this.publish();

    this.web = this.options.webFactory
      ? this.options.webFactory({
          webDir,
          port: this.webPort,
          nodeCommand,
          runAsNode,
          spawnFn: this.options.spawnFn,
          onLog: this.options.onLog,
        })
      : createWebServer({
          webDir,
          port: this.webPort,
          nodeCommand,
          runAsNode,
          spawnFn: this.options.spawnFn,
          onLog: this.options.onLog,
        });
    this.wire(this.web);
    await this.web.start();
    this.publish();

    return { apiUrl: this.getApiUrl(), webUrl: this.getWebUrl() };
  }

  async restart(id: 'api' | 'web'): Promise<void> {
    const service = id === 'api' ? this.api : this.web;
    if (service) {
      await service.restart();
    }
    this.publish();
  }

  /** Restarts any embedded service, including Postgres (used by the heartbeat). */
  async restartService(id: ServiceId): Promise<void> {
    if (id === 'postgres') {
      if (this.postgres) {
        await this.postgres.start();
      }
    } else {
      const service = id === 'api' ? this.api : this.web;
      if (service) {
        await service.restart();
      }
    }
    this.publish();
  }

  /**
   * Liveness check used by the heartbeat. Managed children track their own
   * process state; Postgres needs a real probe because the shell never sees
   * its child process.
   */
  async isServiceAlive(id: ServiceId): Promise<boolean> {
    if (id === 'postgres') {
      return this.postgres ? this.postgres.isAlive() : false;
    }
    const service = id === 'api' ? this.api : this.web;
    return service?.getState() === 'running';
  }

  async stopAll(): Promise<void> {
    if (this.web) {
      await this.web.stop();
      this.web = null;
    }
    if (this.api) {
      await this.api.stop();
      this.api = null;
    }
    if (this.postgres) {
      await this.postgres.stop();
      this.postgres = null;
    }
    this.publish();
  }
}

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { connect } from 'node:net';
import EmbeddedPostgres from 'embedded-postgres';
import type { ServiceState } from '../../shared/desktop-api.js';

export type PostgresLike = {
  getState(): ServiceState;
  getPort(): number;
  connectionUri(database?: string): string;
  /** True when the postmaster accepts connections on its port. */
  isAlive(): Promise<boolean>;
  start(): Promise<void>;
  stop(): Promise<void>;
};

export type PostgresServerOptions = {
  /** Directory where the Postgres cluster persists. */
  databaseDir: string;
  port: number;
  user?: string;
  password?: string;
  databaseName?: string;
  onLog?: (line: string) => void;
};

/**
 * Bundled PostgreSQL. The desktop app owns its own Postgres cluster inside
 * the userData directory, so a fresh install needs no external services.
 * Falls back to the embedded instance only when the app is packaged; the
 * desktop shell always uses this instance for the API.
 */
export class PostgresServer implements PostgresLike {
  private readonly pg: EmbeddedPostgres;
  private readonly options: Required<PostgresServerOptions>;
  private state: ServiceState = 'stopped';

  constructor(options: PostgresServerOptions) {
    this.options = {
      user: 'postgres',
      password: 'postgres',
      databaseName: 'bro',
      onLog: (): void => undefined,
      ...options,
    };
    this.pg = new EmbeddedPostgres({
      databaseDir: this.options.databaseDir,
      port: this.options.port,
      user: this.options.user,
      password: this.options.password,
      authMethod: 'password',
      persistent: true,
      onLog: (message): void => this.options.onLog(`postgres: ${message}`),
      onError: (error): void => this.options.onLog(`postgres: ${String(error)}`),
    });
  }

  getState(): ServiceState {
    return this.state;
  }

  getPort(): number {
    return this.options.port;
  }

  connectionUri(database: string = this.options.databaseName): string {
    const encodedPassword = encodeURIComponent(this.options.password);
    return `postgresql://${this.options.user}:${encodedPassword}@127.0.0.1:${this.options.port}/${database}`;
  }

  async isAlive(): Promise<boolean> {
    if (this.state !== 'running') {
      return false;
    }
    return new Promise((resolve) => {
      const socket = connect({ host: '127.0.0.1', port: this.options.port });
      const onDone = (alive: boolean): void => {
        socket.destroy();
        resolve(alive);
      };
      socket.setTimeout(2000, () => onDone(false));
      socket.once('connect', () => onDone(true));
      socket.once('error', () => onDone(false));
    });
  }

  async start(): Promise<void> {
    if (this.state === 'running') {
      return;
    }
    this.state = 'starting';
    const alreadyInitialised = existsSync(join(this.options.databaseDir, 'PG_VERSION'));
    if (!alreadyInitialised) {
      await this.pg.initialise();
    }
    await this.pg.start();
    await this.pg.createDatabase(this.options.databaseName).catch(() => {
      // The database already exists from a previous run - that is expected.
    });
    this.state = 'running';
  }

  async stop(): Promise<void> {
    if (this.state === 'stopped') {
      return;
    }
    // embedded-postgres' stop() waits for a graceful postmaster shutdown and
    // can stall while the API's connection pool drains. Never block the app
    // quit on it, and force the postmaster down afterwards so a slow quit can
    // never leave an orphaned database server behind.
    await Promise.race([this.pg.stop(), new Promise((resolve) => setTimeout(resolve, 10_000))]);
    this.forceStop();
    this.state = 'stopped';
  }

  private forceStop(): void {
    if (process.platform !== 'win32') {
      return;
    }
    if (!existsSync(join(this.options.databaseDir, 'postmaster.pid'))) {
      return;
    }
    const pgCtl = join(
      __dirname,
      '..',
      '..',
      '..',
      'node_modules',
      '@embedded-postgres',
      'windows-x64',
      'native',
      'bin',
      'pg_ctl.exe',
    );
    if (!existsSync(pgCtl)) {
      return;
    }
    spawnSync(pgCtl, ['-D', this.options.databaseDir, 'stop', '-m', 'immediate'], {
      stdio: 'ignore',
    });
  }
}

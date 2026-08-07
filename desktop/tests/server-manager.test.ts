import { describe, expect, it, vi } from 'vitest';
import { ServerManager } from '../src/main/servers/server-manager.js';
import type { ManagedProcess } from '../src/main/servers/process-manager.js';
import type { ServiceState } from '../src/shared/desktop-api.js';
import type { PostgresLike } from '../src/main/servers/postgres-server.js';
import { DEFAULT_DESKTOP_CONFIG } from '../src/shared/desktop-api.js';
import type { RuntimeSecrets } from '../src/main/servers/api-server.js';

const secrets: RuntimeSecrets = {
  jwtSecret: 'a'.repeat(32),
  jwtRefreshSecret: 'b'.repeat(32),
  cookieSecret: 'c'.repeat(32),
  encryptionKey: 'd'.repeat(32),
};

class FakeService implements ManagedProcess {
  readonly label: string;
  state: ServiceState = 'stopped';
  private readonly listeners = new Set<(state: ServiceState, message?: string) => void>();
  readonly onStart: () => void;

  constructor(label: string, onStart: () => void) {
    this.label = label;
    this.onStart = onStart;
  }

  getState(): ServiceState {
    return this.state;
  }

  getExitCode(): number | null {
    return null;
  }

  async start(): Promise<void> {
    this.onStart();
    this.setState('running');
  }

  async stop(): Promise<void> {
    this.setState('stopped');
  }

  async restart(): Promise<void> {
    this.setState('stopped');
    await this.start();
  }

  onStateChange(callback: (state: ServiceState, message?: string) => void): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  private setState(next: ServiceState): void {
    this.state = next;
    for (const listener of this.listeners) {
      listener(next);
    }
  }
}

function fakePostgres(): PostgresLike {
  return {
    getState: () => 'running',
    getPort: () => 54321,
    connectionUri: () => 'postgresql://fake',
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    isAlive: vi.fn(async () => true),
  };
}

function makeManager(onStart: (label: string) => void) {
  const postgres = fakePostgres();
  const manager = new ServerManager({
    apiDir: '/runtime/api',
    webDir: '/runtime/web',
    dataDir: '/data',
    postgresDir: '/pg',
    secrets,
    getConfig: async () => ({ ...DEFAULT_DESKTOP_CONFIG }),
    nodeCommand: 'node',
    runAsNode: true,
    postgresFactory: () => postgres,
    migrationsFn: async () => onStart('migrate'),
    apiFactory: (options) => new FakeService('api', () => onStart(`api:${options.port}`)),
    webFactory: (options) => new FakeService('web', () => onStart(`web:${options.port}`)),
  });
  return { manager, postgres };
}

describe('ServerManager', () => {
  it('starts services in order and returns the runtime URLs', async () => {
    const order: string[] = [];
    const { manager } = makeManager((label) => order.push(label));
    const urls = await manager.startAll();
    const ports = manager.getPorts();
    expect(order).toEqual(['migrate', `api:${ports.api}`, `web:${ports.web}`]);
    expect(urls.apiUrl).toBe(`http://127.0.0.1:${ports.api}`);
    expect(urls.webUrl).toBe(`http://127.0.0.1:${ports.web}`);
    const reports = manager.getReports();
    expect(reports.map((report) => report.id)).toEqual(['postgres', 'api', 'web']);
    expect(reports.every((report) => report.state === 'running')).toBe(true);
  });

  it('restarts a single service', async () => {
    const order: string[] = [];
    const { manager } = makeManager((label) => order.push(label));
    await manager.startAll();
    const apiPort = manager.getPorts().api;
    await manager.restart('api');
    const api = manager.getReports().find((report) => report.id === 'api');
    expect(api?.state).toBe('running');
    expect(order.filter((entry) => entry === `api:${apiPort}`).length).toBe(2);
  });

  it('stops everything on stopAll', async () => {
    const { manager, postgres } = makeManager(() => undefined);
    await manager.startAll();
    await manager.stopAll();
    expect(manager.getReports()).toEqual([]);
    expect(postgres.stop).toHaveBeenCalled();
  });
});

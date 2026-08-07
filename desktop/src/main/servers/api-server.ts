import { join } from 'node:path';
import { createManagedProcess, type ManagedProcess, type SpawnFn } from './process-manager.js';

export type RuntimeSecrets = {
  jwtSecret: string;
  jwtRefreshSecret: string;
  cookieSecret: string;
  encryptionKey: string;
};

export type ApiServerOptions = {
  /** Directory containing the compiled API (resources/runtime/api). */
  apiDir: string;
  /** Writable data dir the API runs from (sandbox, plugins, marketplace). */
  dataDir: string;
  port: number;
  /** Connection URI of the local PostgreSQL instance. */
  databaseUrl: string;
  /** Browser origin the web app is served from (CORS + CSRF allowlist). */
  webOrigin: string;
  browserEnabled: boolean;
  secrets: RuntimeSecrets;
  nodeCommand?: string;
  runAsNode?: boolean;
  spawnFn?: SpawnFn;
  onLog?: (line: string) => void;
};

function healthProbe(port: number): () => Promise<boolean> {
  return async () => {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(2000),
      });
      return response.status < 500;
    } catch {
      return false;
    }
  };
}

/**
 * Spawns the existing Fastify API (`dist/server.js`) as a managed child
 * process. The backend is untouched: it is configured purely through the
 * environment it already reads (see src/config/index.ts).
 */
export function createApiServer(options: ApiServerOptions): ManagedProcess {
  const entry = join(options.apiDir, 'dist', 'server.js');
  const env: Record<string, string | undefined> = {
    NODE_ENV: 'production',
    PORT: String(options.port),
    DATABASE_URL: options.databaseUrl,
    JWT_SECRET: options.secrets.jwtSecret,
    JWT_REFRESH_SECRET: options.secrets.jwtRefreshSecret,
    COOKIE_SECRET: options.secrets.cookieSecret,
    ENCRYPTION_KEY: options.secrets.encryptionKey,
    CORS_ORIGIN: options.webOrigin,
    CSRF_PROTECTION_ENABLED: 'true',
    INTEGRATION_REDIRECT_BASE: `http://127.0.0.1:${options.port}/api/v1/integrations`,
    TOOL_FS_ROOT: join(options.dataDir, 'sandbox'),
    PLUGINS_DIR: join(options.dataDir, 'plugins'),
    MARKETPLACE_STATE_FILE: join(options.dataDir, 'marketplace-state.json'),
    BROWSER_ENABLED: options.browserEnabled ? 'true' : 'false',
    LOG_LEVEL: process.env.BRO_DESKTOP_LOG_LEVEL ?? 'info',
  };

  return createManagedProcess({
    label: 'api',
    command: options.nodeCommand ?? process.execPath,
    args: [entry],
    cwd: options.dataDir,
    env,
    runAsNode: options.runAsNode,
    health: healthProbe(options.port),
    startTimeoutMs: 60_000,
    spawnFn: options.spawnFn,
    onLog: options.onLog,
  });
}

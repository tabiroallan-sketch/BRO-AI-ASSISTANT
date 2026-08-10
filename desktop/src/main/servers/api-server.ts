import { join } from 'node:path';
import { createManagedProcess, type ManagedProcess, type SpawnFn } from './process-manager.js';

/**
 * Environment variables the embedded API reads for AI providers (see
 * src/config/index.ts in the backend). The shell forwards these from its own
 * environment so keys configured in the parent process (or the repo .env in
 * dev) reach the API child, which otherwise only loads .env from its own cwd.
 */
export const AI_PROVIDER_ENV_VARS = [
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'OPENAI_MODEL',
  'NVIDIA_API_KEY',
  'NVIDIA_BASE_URL',
  'LLM_FALLBACK_ENABLED',
  'LLM_FALLBACK_ORDER',
  'ELEVENLABS_API_KEY',
] as const;

/**
 * Additional env vars the shell forwards to the embedded API child because the
 * backend reads them from the environment (see src/config/index.ts) and the
 * child otherwise only loads .env from its own cwd.
 */
export const API_PASSTHROUGH_ENV_VARS = [...AI_PROVIDER_ENV_VARS, 'ADMIN_EMAILS'] as const;

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
    CORS_ORIGIN: `${options.webOrigin},http://localhost:3001`,
    CSRF_PROTECTION_ENABLED: 'true',
    INTEGRATION_REDIRECT_BASE: `http://127.0.0.1:${options.port}/api/v1/integrations`,
    TOOL_FS_ROOT: join(options.dataDir, 'sandbox'),
    PLUGINS_DIR: join(options.dataDir, 'plugins'),
    MARKETPLACE_STATE_FILE: join(options.dataDir, 'marketplace-state.json'),
    BROWSER_ENABLED: options.browserEnabled ? 'true' : 'false',
    LOG_LEVEL: process.env.BRO_DESKTOP_LOG_LEVEL ?? 'info',
  };
  for (const name of API_PASSTHROUGH_ENV_VARS) {
    const value = process.env[name];
    if (value) {
      env[name] = value;
    }
  }

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

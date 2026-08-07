import { join } from 'node:path';
import { createManagedProcess, type ManagedProcess, type SpawnFn } from './process-manager.js';

export type WebServerOptions = {
  /** Directory containing the Next.js standalone build (resources/runtime/web). */
  webDir: string;
  port: number;
  nodeCommand?: string;
  runAsNode?: boolean;
  spawnFn?: SpawnFn;
  onLog?: (line: string) => void;
};

function healthProbe(port: number): () => Promise<boolean> {
  return async () => {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/login`, {
        signal: AbortSignal.timeout(2000),
      });
      return response.status < 500;
    } catch {
      return false;
    }
  };
}

/**
 * Spawns the Next.js standalone server produced by `next build` with
 * `BRO_DESKTOP_BUILD=1`. Same server code as the web Docker image, hosted as
 * a managed child process so the desktop window always runs the shipped app.
 */
export function createWebServer(options: WebServerOptions): ManagedProcess {
  const env: Record<string, string | undefined> = {
    NODE_ENV: 'production',
    PORT: String(options.port),
    HOSTNAME: '127.0.0.1',
    NEXT_TELEMETRY_DISABLED: '1',
  };

  return createManagedProcess({
    label: 'web',
    command: options.nodeCommand ?? process.execPath,
    args: [join(options.webDir, 'server.js')],
    cwd: options.webDir,
    env,
    runAsNode: options.runAsNode,
    health: healthProbe(options.port),
    startTimeoutMs: 60_000,
    spawnFn: options.spawnFn,
    onLog: options.onLog,
  });
}

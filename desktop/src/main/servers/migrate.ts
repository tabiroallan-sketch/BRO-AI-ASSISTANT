import { spawn } from 'node:child_process';
import { join } from 'node:path';

export type MigrateOptions = {
  /** Directory containing the compiled API (resources/runtime/api). */
  apiDir: string;
  /** Connection URI of the target database. */
  databaseUrl: string;
  /** Overridable for tests. */
  nodeCommand?: string;
  runAsNode?: boolean;
  onLog?: (line: string) => void;
};

/**
 * Applies pending Prisma migrations to the local database. Mirrors the Docker
 * entrypoint (`scripts/entrypoint.sh`) by invoking the Prisma CLI that ships
 * inside the API runtime bundle.
 */
export async function runMigrations(options: MigrateOptions): Promise<void> {
  const { apiDir, databaseUrl } = options;
  const cliPath = join(apiDir, 'node_modules', 'prisma', 'build', 'index.js');
  const schemaPath = join(apiDir, 'prisma', 'schema.prisma');

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    PRISMA_HIDE_UPDATE_MESSAGE: '1',
    ...(options.runAsNode ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
  };

  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      options.nodeCommand ?? process.execPath,
      [cliPath, 'migrate', 'deploy', '--schema', schemaPath],
      { env, windowsHide: true },
    );
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => options.onLog?.(chunk.toString('utf8')));
    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      stderr += text;
      options.onLog?.(text);
    });
    child.on('error', (error) => reject(error));
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(`Prisma migrate deploy failed (exit ${code ?? 'unknown'}): ${stderr.trim()}`),
        );
      }
    });
  });
}

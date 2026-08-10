import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { API_PASSTHROUGH_ENV_VARS } from './servers/api-server.js';

/**
 * Dev convenience: when the shell runs from the repository (not packaged), seed
 * backend env vars (AI provider keys, admin emails) from the repo-root `.env`
 * into the environment. The embedded API child would otherwise miss them,
 * because dotenv only loads `.env` from the child's own working directory (the
 * userData data dir in embedded mode). Only the passthrough vars are merged,
 * and existing values are never overridden. Packaged builds find no repo
 * `.env`, so this is a no-op there.
 */
export function loadDevAiEnv(appPath: string): void {
  const envPath = join(appPath, '..', '.env');
  if (!existsSync(envPath)) {
    return;
  }
  let source: string;
  try {
    source = readFileSync(envPath, 'utf8');
  } catch {
    return;
  }
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const separator = line.indexOf('=');
    if (separator < 0) {
      continue;
    }
    const name = line.slice(0, separator).trim();
    if (!(API_PASSTHROUGH_ENV_VARS as readonly string[]).includes(name)) {
      continue;
    }
    if (process.env[name] !== undefined) {
      continue;
    }
    let value = line.slice(separator + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    process.env[name] = value;
  }
}

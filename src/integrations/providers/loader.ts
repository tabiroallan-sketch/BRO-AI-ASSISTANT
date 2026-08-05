import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { logger } from '../../lib/logger.js';
import { registerProvider } from '../registry.js';
import { validateProviderDef } from './manifest.js';

const PROVIDER_FILE_PATTERN = /^bro\.provider\.(ts|js|mjs|cjs)$/;

export type ProviderLoadResult = {
  loaded: string[];
  failed: { file: string; error: string }[];
};

async function findProviderFiles(dir: string): Promise<string[]> {
  const found: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') {
        continue;
      }
      found.push(...(await findProviderFiles(fullPath)));
    } else if (entry.isFile() && PROVIDER_FILE_PATTERN.test(entry.name)) {
      found.push(fullPath);
    }
  }
  return found;
}

/**
 * Loads third-party providers dropped into a directory as
 * bro.provider.(ts|js|mjs|cjs) files. Mirrors the plugin loader so new
 * providers install without touching core code. Built-ins are unaffected:
 * a disk provider that collides with a built-in id is skipped with a warning.
 */
export async function loadProvidersFromDisk(dir: string): Promise<ProviderLoadResult> {
  const files = await findProviderFiles(dir);
  const result: ProviderLoadResult = { loaded: [], failed: [] };

  await Promise.all(
    files.map(async (file) => {
      try {
        const url = pathToFileURL(file).href;
        const imported = (await import(url)) as Record<string, unknown>;
        const raw = imported.default ?? imported.provider ?? imported.providers;
        if (raw === undefined) {
          throw new Error(
            'provider file must export a provider as default, "provider", or "providers"',
          );
        }
        const defs = Array.isArray(raw) ? raw : [raw];
        for (const def of defs) {
          const validation = validateProviderDef(def);
          if (!validation.ok) {
            throw new Error(validation.error);
          }
          if (registerProvider(validation.def)) {
            result.loaded.push(validation.def.id);
            logger.info({ provider: validation.def.id, file }, 'Provider installed from disk');
          } else {
            logger.warn(
              { provider: validation.def.id, file },
              'Provider id is already registered and was skipped',
            );
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error({ err: error, file }, 'Failed to load provider');
        result.failed.push({ file, error: message });
      }
    }),
  );

  return result;
}

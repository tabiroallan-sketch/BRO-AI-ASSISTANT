import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { build } from 'esbuild';

/**
 * Bundles the preload script into a single CommonJS file. Sandboxed preloads
 * can only `require('electron')` and Node builtins, so the local shared-module
 * import is inlined here. Output replaces the tsc-emitted dist/preload/index.js.
 */

const desktopDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(desktopDir, 'dist', 'preload');
mkdirSync(outDir, { recursive: true });

await build({
  entryPoints: [join(desktopDir, 'src', 'preload', 'index.ts')],
  outfile: join(outDir, 'index.js'),
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node22',
  external: ['electron'],
  sourcemap: true,
  logLevel: 'info',
});

console.log('[build-preload] bundled dist/preload/index.js');

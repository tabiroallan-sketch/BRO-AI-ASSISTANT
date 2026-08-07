import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Produces the Next.js standalone build used by the desktop shell at
 * resources/runtime/web. `BRO_DESKTOP_BUILD=1` switches next.config.ts to
 * `output: 'standalone'`; the resulting self-contained server runs as a
 * managed child process.
 */

const desktopDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const webDir = join(desktopDir, '..', 'web');
const webRuntime = join(desktopDir, 'resources', 'runtime', 'web');

function run(command, args, cwd, env) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32', env });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log('[build-web] compiling web app (standalone)...');
const env = { ...process.env, BRO_DESKTOP_BUILD: '1' };
run('npm', ['run', 'build'], webDir, env);

console.log('[build-web] staging runtime/web...');
rmSync(webRuntime, { recursive: true, force: true });
mkdirSync(webRuntime, { recursive: true });

const standaloneDir = join(webDir, '.next', 'standalone');
if (!existsSync(standaloneDir)) {
  console.error('[build-web] standalone output missing - is BRO_DESKTOP_BUILD set?');
  process.exit(1);
}

// Next.js nests the app under its source-folder prefix (e.g. standalone/web)
// when the project lives in a subdirectory. Flatten it so the entry point is
// always webRuntime/server.js.
const nestedAppDir = join(standaloneDir, 'web');
const standaloneRoot = existsSync(join(nestedAppDir, 'server.js')) ? nestedAppDir : standaloneDir;
cpSync(standaloneRoot, webRuntime, { recursive: true });

const staticSrc = join(webDir, '.next', 'static');
if (existsSync(staticSrc)) {
  cpSync(staticSrc, join(webRuntime, '.next', 'static'), { recursive: true });
}
const publicSrc = join(webDir, 'public');
if (existsSync(publicSrc)) {
  cpSync(publicSrc, join(webRuntime, 'public'), { recursive: true });
}

console.log(`[build-web] done: ${webRuntime}`);

import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Release packaging. Builds the icons, the API bundle, the web bundle and the
 * desktop main/preload, then runs electron-builder. The GitHub publish owner
 * and repository are read from BRO_GH_OWNER / BRO_GH_REPO (matching the
 * electron-builder.yml publish block); a release is only published when those
 * are provided.
 */

const desktopDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const isWindows = process.platform === 'win32';
const npm = isWindows ? 'npm.cmd' : 'npm';

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: isWindows });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run('node', ['scripts/make-icons.mjs'], desktopDir);
run('node', ['scripts/build-api.mjs'], desktopDir);
run('node', ['scripts/build-web.mjs'], desktopDir);
run(npm, ['run', 'build'], desktopDir);

console.log('[package] running electron-builder...');
const builderArgs = ['--config', 'electron-builder.yml'];
if (process.env.BRO_GH_OWNER && process.env.BRO_GH_REPO) {
  builderArgs.push('--publish', 'always');
  console.log(`[package] publishing to GitHub Releases (${process.env.BRO_GH_OWNER}/${process.env.BRO_GH_REPO})`);
} else {
  builderArgs.push('--publish', 'never');
  console.log('[package] BRO_GH_OWNER/BRO_GH_REPO not set - skipping publish');
}
run(npxBin(desktopDir), ['electron-builder', ...builderArgs], desktopDir);
console.log('[package] done');

function npxBin(cwd) {
  return join(cwd, 'node_modules', '.bin', isWindows ? 'electron-builder.cmd' : 'electron-builder');
}

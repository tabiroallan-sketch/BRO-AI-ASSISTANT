import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Bundles the existing Fastify API into resources/runtime/api so the desktop
 * shell can run it as a managed child process. Mirrors the root Dockerfile:
 * compile dist/, stage it with prisma + prod dependencies, then generate the
 * Prisma client in place.
 */

const desktopDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const rootDir = join(desktopDir, '..');
const apiDir = join(desktopDir, 'resources', 'runtime', 'api');

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log('[build-api] compiling backend...');
run('npm', ['run', 'build'], rootDir);

console.log('[build-api] staging runtime/api...');
rmSync(apiDir, { recursive: true, force: true });
mkdirSync(apiDir, { recursive: true });
cpSync(join(rootDir, 'dist'), join(apiDir, 'dist'), { recursive: true });
cpSync(join(rootDir, 'prisma'), join(apiDir, 'prisma'), { recursive: true });
cpSync(join(rootDir, 'package.json'), join(apiDir, 'package.json'));
cpSync(join(rootDir, 'package-lock.json'), join(apiDir, 'package-lock.json'));

console.log('[build-api] installing production dependencies...');
run('npm', ['ci', '--omit=dev'], apiDir);

console.log('[build-api] copying Prisma CLI (dev tool, needed for migrations)...');
for (const path of ['prisma', '@prisma/engines', '@prisma/engines-version', '@prisma/client']) {
  const source = join(rootDir, 'node_modules', path);
  if (existsSync(source)) {
    cpSync(source, join(apiDir, 'node_modules', path), { recursive: true });
  }
}
const binDir = join(apiDir, 'node_modules', '.bin');
mkdirSync(binDir, { recursive: true });
for (const file of ['prisma', 'prisma.cmd', 'prisma.ps1']) {
  const source = join(rootDir, 'node_modules', '.bin', file);
  if (existsSync(source)) {
    cpSync(source, join(binDir, file));
  }
}

console.log('[build-api] generating Prisma client in the bundle...');
run('npx', ['prisma', 'generate', '--schema', join(apiDir, 'prisma', 'schema.prisma')], apiDir);

console.log(`[build-api] done: ${apiDir}`);

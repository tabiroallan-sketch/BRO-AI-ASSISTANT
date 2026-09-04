import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Development launcher. Starts the backend (root, port 3000) and the web app
 * (web, port 3001) as child processes, waits for them to become healthy, then
 * launches the Electron shell in dev mode (BRO_DESKTOP_DEV=1) pointed at the
 * external servers. All children are killed when the shell exits.
 */

const desktopDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const rootDir = join(desktopDir, '..');
const webDir = join(rootDir, 'web');
const isWindows = process.platform === 'win32';
const npm = isWindows ? 'npm.cmd' : 'npm';

const children = [];
let shuttingDown = false;

function shutdown(code) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  for (const child of children) {
    child.kill();
  }
  process.exit(code ?? 0);
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => shutdown(0));
}

async function waitForHealthy(url, label, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.status < 500) {
        console.log(`[dev] ${label} is up (${url})`);
        return;
      }
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  console.error(`[dev] ${label} did not become healthy within ${timeoutMs}ms`);
  shutdown(1);
}

async function main() {
  const api = spawn(npm, ['run', 'dev'], { cwd: rootDir, stdio: 'inherit', shell: isWindows });
  const web = spawn(npm, ['run', 'dev'], { cwd: webDir, stdio: 'inherit', shell: isWindows });
  children.push(api, web);
  api.on('exit', (code) => {
    if (!shuttingDown && code !== 0) {
      console.error('[dev] backend exited unexpectedly');
      shutdown(1);
    }
  });
  web.on('exit', (code) => {
    if (!shuttingDown && code !== 0) {
      console.error('[dev] web exited unexpectedly');
      shutdown(1);
    }
  });

  await waitForHealthy('http://127.0.0.1:3000/health', 'api');
  await waitForHealthy('http://127.0.0.1:3001/login', 'web');

  const electronBin = join(
    desktopDir,
    'node_modules',
    'electron',
    'dist',
    isWindows ? 'electron.exe' : 'electron',
  );
  const electron = spawn(electronBin, [desktopDir], {
    cwd: desktopDir,
    stdio: 'inherit',
    env: { ...process.env, BRO_DESKTOP_DEV: '1' },
  });
  children.push(electron);
  electron.on('exit', (code) => shutdown(code ?? 0));
}

void main();

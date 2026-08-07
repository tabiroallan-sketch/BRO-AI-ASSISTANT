import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { _electron as electron } from 'playwright';

/**
 * End-to-end smoke test for the desktop shell. Builds the API + web runtime
 * bundles (if missing), launches the packaged-style app in embedded mode with
 * an isolated userData directory, and asserts that the preload bridge, the
 * config IPC surface, and all three embedded services come up.
 */

const desktopDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const isWindows = process.platform === 'win32';

function ensureRuntime() {
  const api = join(desktopDir, 'resources', 'runtime', 'api', 'dist', 'server.js');
  const web = join(desktopDir, 'resources', 'runtime', 'web', 'server.js');
  if (!existsSync(api) || !existsSync(web)) {
    console.log('[e2e] runtime bundles missing - building (this can take a while)...');
    for (const script of ['build-api.mjs', 'build-web.mjs']) {
      const result = spawnSync(process.execPath, [`scripts/${script}`], {
        cwd: desktopDir,
        stdio: 'inherit',
      });
      if (result.status !== 0) {
        console.error(`[e2e] ${script} failed`);
        process.exit(result.status ?? 1);
      }
    }
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`e2e assertion failed: ${message}`);
  }
}

async function waitFor(predicate, timeoutMs = 90_000, label = 'condition') {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await predicate();
      if (last) {
        return last;
      }
    } catch (error) {
      last = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(
    `Timed out waiting for ${label} (last: ${last instanceof Error ? last.message : String(last)})`,
  );
}

async function main() {
  ensureRuntime();

  const userData = mkdtempSync(join(tmpdir(), 'bro-e2e-'));
  const electronBin = join(
    desktopDir,
    'node_modules',
    'electron',
    'dist',
    isWindows ? 'electron.exe' : 'electron',
  );

  console.log('[e2e] launching BRO (embedded mode)...');
  const app = await electron.launch({
    executablePath: electronBin,
    args: [desktopDir],
    cwd: desktopDir,
    env: {
      ...process.env,
      BRO_USER_DATA_DIR: userData,
      BRO_DESKTOP_LOG_LEVEL: 'debug',
    },
    timeout: 120_000,
  });

  app.process().stdout?.on('data', (chunk) => process.stdout.write(`[bro-main] ${chunk}`));
  app.process().stderr?.on('data', (chunk) => process.stderr.write(`[bro-main] ${chunk}`));
  app.on('console', (message) => process.stdout.write(`[bro-renderer] ${message.text()}\n`));

  try {
    const page = await app.firstWindow({ timeout: 180_000 });
    await page.waitForLoadState('domcontentloaded', { timeout: 30_000 });

    console.log('[e2e] checking preload bridge...');
    const bridge = await page.evaluate(() => {
      const api = window.broDesktop;
      return {
        hasApi: typeof api === 'object' && api !== null,
        platform: api?.platform ?? null,
        isPackaged: api?.isPackaged ?? null,
        versions: api?.versions ?? null,
        apiUrl: window.__BRO_API_URL__ ?? null,
      };
    });
    assert(bridge.hasApi, 'window.broDesktop is missing');
    assert(bridge.platform === process.platform, 'platform mismatch');
    assert(bridge.apiUrl && bridge.apiUrl.startsWith('http://127.0.0.1:'), 'no injected API URL');
    assert(bridge.versions && bridge.versions.electron, 'no electron version exposed');

    console.log('[e2e] waiting for embedded services to be running...');
    const reports = await waitFor(
      async () => {
        const current = await page.evaluate(() => window.broDesktop.servers.status());
        return current.length === 3 && current.every((report) => report.state === 'running')
          ? current
          : null;
      },
      120_000,
      'all services running',
    );
    const apiReport = reports.find((report) => report.id === 'api');
    assert(apiReport, 'api report missing');

    console.log('[e2e] checking config IPC roundtrip...');
    const defaults = await page.evaluate(() => window.broDesktop.config.get());
    assert(defaults.theme === 'system', `expected default theme 'system', got ${defaults.theme}`);
    const updated = await page.evaluate(() => window.broDesktop.config.set({ theme: 'dark' }));
    assert(updated.theme === 'dark', 'config.set did not apply theme');
    const reloaded = await page.evaluate(() => window.broDesktop.config.get());
    assert(reloaded.theme === 'dark', 'config.get did not persist theme');

    console.log('[e2e] checking API health...');
    const health = await page.evaluate(async (port) => {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      return { status: response.status, ok: response.ok };
    }, apiReport.port);
    assert(health.ok, `API health returned ${health.status}`);

    console.log('[e2e] checking update status (expected disabled in dev)');
    const updateStatus = await page.evaluate(() => window.broDesktop.updates.status());
    assert(
      updateStatus.state === 'disabled',
      `expected disabled update state, got ${updateStatus.state}`,
    );

    console.log('[e2e] checking overlay window (show/resize/hide)...');
    await page.evaluate(() => window.broDesktop.overlay.show());
    const overlayWindow = await waitFor(
      async () => {
        const windows = await app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows().map((w) => ({
            url: w.webContents.getURL(),
            visible: w.isVisible(),
          })),
        );
        const overlay = windows.find((w) => w.url.endsWith('/overlay'));
        return overlay && overlay.visible ? overlay : null;
      },
      30_000,
      'overlay visible',
    );
    assert(overlayWindow, 'overlay.show() did not produce a visible /overlay window');
    assert(
      overlayWindow.url.endsWith('/overlay'),
      `overlay loaded unexpected URL: ${overlayWindow.url}`,
    );

    const overlayPage = app.windows().find((w) => w.url().endsWith('/overlay'));
    assert(overlayPage, 'overlay page not available to playwright');
    const overlayBridge = await overlayPage.evaluate(() => ({
      hasOverlay:
        typeof window.broDesktop?.overlay?.hide === 'function' &&
        typeof window.broDesktop?.overlay?.resize === 'function',
      hasCommands: typeof window.broDesktop?.commands?.onListeningStart === 'function',
      hasWindowShow: typeof window.broDesktop?.window?.show === 'function',
    }));
    assert(overlayBridge.hasOverlay, 'overlay preload bridge missing overlay API');
    assert(overlayBridge.hasCommands, 'overlay preload bridge missing commands API');
    assert(overlayBridge.hasWindowShow, 'overlay preload bridge missing window.show()');

    await page.evaluate(() => window.broDesktop.overlay.resize(400, 500));
    const overlayBounds = await app.evaluate(({ BrowserWindow }) => {
      const overlay = BrowserWindow.getAllWindows().find((w) =>
        w.webContents.getURL().endsWith('/overlay'),
      );
      return overlay ? overlay.getBounds() : null;
    });
    assert(
      overlayBounds && overlayBounds.width === 400 && overlayBounds.height === 500,
      `overlay.resize() left unexpected bounds: ${JSON.stringify(overlayBounds)}`,
    );

    await page.evaluate(() => window.broDesktop.overlay.hide());
    await waitFor(
      async () => {
        const hidden = await app.evaluate(({ BrowserWindow }) => {
          const overlay = BrowserWindow.getAllWindows().find((w) =>
            w.webContents.getURL().endsWith('/overlay'),
          );
          return overlay ? !overlay.isVisible() : true;
        });
        return hidden ? true : null;
      },
      30_000,
      'overlay hidden',
    );

    console.log('[e2e] ALL CHECKS PASSED');
  } finally {
    // The window hides to tray on close, so app.close() alone would wait
    // forever. Trigger a graceful quit (runs the embedded-services shutdown),
    // then close the debugger connection so the main process can exit once
    // stopAll has finished. Every step is raced so a stuck teardown can never
    // hang the script, and process.exit() guarantees the script terminates
    // even if the playwright connection keeps handles alive.
    await Promise.race([
      app.evaluate(({ app }) => app.quit()).catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, 10_000)),
    ]);
    await Promise.race([
      app.close().catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, 90_000)),
    ]);
    try {
      app.process().kill();
    } catch {
      // Already gone.
    }
    rmSync(userData, { recursive: true, force: true });
  }
}

let succeeded = false;
void main()
  .then(() => {
    succeeded = true;
  })
  .catch((error) => {
    console.error(error);
  })
  .finally(() => process.exit(succeeded ? 0 : 1));

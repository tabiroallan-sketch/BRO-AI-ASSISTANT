import { app, nativeTheme } from 'electron';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { IPC } from '../shared/desktop-api.js';
import { autostart } from './autostart.js';
import { ConfigStore } from './config.js';
import { ConnectivityMonitor } from './connectivity.js';
import { CrashGuard } from './crash.js';
import { registerIpc, watchNativeTheme } from './ipc.js';
import { installApplicationMenu } from './menus.js';
import { createNativeBridge } from './native.js';
import { createNotifier } from './notifications.js';
import { SecretStore } from './secret-store.js';
import { ServerManager } from './servers/server-manager.js';
import { Heartbeat } from './services/heartbeat.js';
import { ShortcutRegistry } from './shortcuts.js';
import { AppTray } from './tray.js';
import { UpdateManager } from './updater.js';
import { WindowStateStore } from './window-state.js';
import { MainWindow } from './windows.js';

const DEV = process.env.BRO_DESKTOP_DEV === '1';
const DEV_API_URL = process.env.BRO_DEV_API_URL ?? 'http://127.0.0.1:3000';
const DEV_WEB_URL = process.env.BRO_DEV_WEB_URL ?? 'http://127.0.0.1:3001';

let mainWindow: MainWindow | null = null;
let manager: ServerManager | null = null;
let tray: AppTray | null = null;
let shortcuts: ShortcutRegistry | null = null;
let updates: UpdateManager | null = null;
let connectivity: ConnectivityMonitor | null = null;
let heartbeat: Heartbeat | null = null;
let stopNativeTheme: (() => void) | null = null;
let quitting = false;
let listening = false;

const setListening = (next: boolean): void => {
  listening = next;
  if (mainWindow) {
    tray?.setListening(mainWindow, next);
  }
};

app.setName('BRO');
app.setAppUserModelId('com.bro.desktop');

const userDataOverride = process.env.BRO_USER_DATA_DIR;
if (userDataOverride) {
  app.setPath('userData', userDataOverride);
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      mainWindow.focus();
    }
  });
  void bootstrap();
}

function runtimeDir(service: 'api' | 'web'): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'runtime', service);
  }
  return join(app.getAppPath(), 'resources', 'runtime', service);
}

function assetPath(fileName: string): string | undefined {
  const candidates = [
    join(app.getAppPath(), 'resources', fileName),
    join(process.resourcesPath, fileName),
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

function requestQuit(): void {
  quitting = true;
  app.quit();
}

async function bootstrap(): Promise<void> {
  const userData = app.getPath('userData');
  const dataDir = join(userData, 'data');
  const logDir = join(userData, 'logs');
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(logDir, { recursive: true });

  const config = new ConfigStore({ filePath: join(userData, 'config.json') });
  const secrets = new SecretStore({ filePath: join(userData, 'secrets.json') }).ensure();
  const notifier = createNotifier();
  const native = createNativeBridge();
  const crash = new CrashGuard({ logFile: join(logDir, 'crash.log') });

  await app.whenReady();

  const configState = await config.get();
  nativeTheme.themeSource = configState.theme;
  const theme = {
    getSource: (): 'system' | 'light' | 'dark' => nativeTheme.themeSource,
    setSource: (source: 'system' | 'light' | 'dark'): void => {
      nativeTheme.themeSource = source;
    },
  };

  const onLog = (line: string): void => console.log(`[bro] ${line}`);

  let webUrl = DEV_WEB_URL;
  let apiBaseUrl = `${DEV_API_URL}/api/v1`;

  if (!DEV) {
    manager = new ServerManager({
      apiDir: runtimeDir('api'),
      webDir: runtimeDir('web'),
      dataDir,
      postgresDir: join(userData, 'postgres'),
      secrets,
      getConfig: () => config.get(),
      nodeCommand: process.execPath,
      runAsNode: true,
      onLog,
    });
    manager.onStatus((reports) => mainWindow?.send(IPC.serversChanged, reports));
    try {
      const urls = await manager.startAll();
      webUrl = urls.webUrl;
      apiBaseUrl = `${urls.apiUrl}/api/v1`;
      onLog(`services online: api=${urls.apiUrl} web=${urls.webUrl}`);
    } catch (error) {
      onLog(
        `embedded services failed to start: ${error instanceof Error ? error.message : String(error)}` +
          (error instanceof Error && error.stack ? `\n${error.stack}` : ''),
      );
    }
  }

  mainWindow = new MainWindow({
    preloadPath: join(__dirname, '..', 'preload', 'index.js'),
    iconPath: assetPath('icon.png'),
    stateStore: new WindowStateStore({ filePath: join(userData, 'window-state.json') }),
    apiBaseUrl,
    closeToTray: () => configState.closeToTray,
    isQuitting: () => quitting,
    onQuitRequested: requestQuit,
  });
  mainWindow.create(webUrl);

  shortcuts = new ShortcutRegistry({
    onTriggered: (id) => {
      if (id === 'open-dashboard') {
        mainWindow?.focus();
        mainWindow?.send(IPC.windowNavigate, '/dashboard');
        return;
      }
      if (id === 'toggle-mic') {
        setListening(!listening);
        mainWindow?.send(IPC.micToggle);
        return;
      }
      mainWindow?.send(IPC.shortcutsTriggered, id);
    },
  });
  shortcuts.register([
    { id: 'open-dashboard', accelerator: 'CommandOrControl+Shift+B' },
    { id: 'toggle-mic', accelerator: 'CommandOrControl+Shift+M' },
  ]);

  updates = new UpdateManager({
    isEnabled: () => !DEV && app.isPackaged,
    onStatus: (status) => mainWindow?.send(IPC.updatesChanged, status),
  });
  updates.init();
  if (configState.autoCheckUpdates) {
    setTimeout(() => {
      void updates?.check();
    }, 10_000);
  }

  const apiOrigin = apiBaseUrl.replace(/\/api\/v1\/?$/, '');
  connectivity = new ConnectivityMonitor({
    probe: async () => {
      try {
        const response = await fetch(`${apiOrigin}/health`, { signal: AbortSignal.timeout(3000) });
        return response.ok;
      } catch {
        return false;
      }
    },
    onStatus: (online) => mainWindow?.send(IPC.networkChanged, online),
  });
  connectivity.start();

  if (manager) {
    // Background service (Stage 2): keeps the embedded services alive while the
    // window is hidden and throttles itself so idle CPU stays low.
    heartbeat = new Heartbeat({
      isBackground: () => Boolean(mainWindow && !mainWindow.isVisible()),
      shouldPause: () => quitting,
      getReports: () => manager?.getReports() ?? [],
      isServiceAlive: (id) => manager?.isServiceAlive(id) ?? Promise.resolve(false),
      restartService: (id) => manager?.restartService(id) ?? Promise.resolve(),
      onTick: (report) => {
        onLog(
          `heartbeat: ${report.services.length} services running, restarted=${report.restarted.length > 0 ? report.restarted.join(',') : 'none'}, heap=${Math.round(report.memory.heapUsed / 1024 / 1024)}MB`,
        );
      },
      onLog,
    });
    heartbeat.start();
  }

  const getWindow = (): Electron.BrowserWindow | null => mainWindow?.instance ?? null;

  registerIpc({
    config,
    mainWindow,
    native,
    shortcuts,
    updates,
    servers: manager ?? {
      getReports: () => [],
      restart: async () => undefined,
    },
    notifier,
    appInfo: {
      name: app.getName(),
      version: app.getVersion(),
      isPackaged: app.isPackaged,
      versions: {
        electron: process.versions.electron ?? '',
        chrome: process.versions.chrome ?? '',
        node: process.versions.node ?? '',
      },
    },
    autostart,
    network: {
      isOnline: () => Promise.resolve(connectivity ? connectivity.onlineState : true),
    },
    theme,
    quit: requestQuit,
    getWindow,
  });

  installApplicationMenu({
    getTheme: () => config.get().then((state) => state.theme),
    setTheme: (source) => {
      void config.set({ theme: source });
      theme.setSource(source);
    },
    onOpenSettings: () => {
      mainWindow?.focus();
      mainWindow?.send(IPC.windowNavigate, '/settings');
    },
    onOpenDevTools: () => getWindow()?.webContents.openDevTools(),
  });

  tray = new AppTray({
    iconPath: assetPath('tray.png') ?? assetPath('icon.png'),
    listening: () => listening,
    onOpenDashboard: () => {
      mainWindow?.focus();
      mainWindow?.send(IPC.windowNavigate, '/dashboard');
    },
    onOpenOverlay: () => {
      mainWindow?.focus();
      mainWindow?.send(IPC.overlayToggle);
    },
    onStartListening: () => {
      setListening(true);
      mainWindow?.send(IPC.listeningStart);
    },
    onStopListening: () => {
      setListening(false);
      mainWindow?.send(IPC.listeningStop);
    },
    onQuit: requestQuit,
  });
  tray.create(mainWindow);

  crash.init(() => mainWindow);
  stopNativeTheme = watchNativeTheme((shouldUseDark) => {
    mainWindow?.send(IPC.themeChanged, shouldUseDark);
  });

  app.on('activate', () => {
    mainWindow?.focus();
  });

  app.on('before-quit', () => {
    quitting = true;
  });

  let cleanupDone = false;
  app.on('will-quit', (event) => {
    if (cleanupDone) {
      return;
    }
    event.preventDefault();
    void (async () => {
      try {
        stopNativeTheme?.();
        shortcuts?.unregisterAll();
        connectivity?.stop();
        heartbeat?.stop();
        tray?.destroy();
        // Shutdown is best-effort: never let a hung embedded service block quit.
        await Promise.race([
          manager?.stopAll() ?? Promise.resolve(),
          new Promise((resolve) => setTimeout(resolve, 30_000)),
        ]);
      } catch {
        // Quit must not be blocked by a failed shutdown.
      } finally {
        cleanupDone = true;
        app.quit();
      }
    })();
  });
}

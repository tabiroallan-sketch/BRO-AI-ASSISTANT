import { app, nativeTheme, session } from 'electron';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  IPC,
  type OperatingMode,
  type ShortcutAction,
  normalizeOperatingMode,
} from '../shared/desktop-api.js';
import { planModeTransition } from './operating-mode.js';
import { autostart } from './autostart.js';
import { ConfigStore } from './config.js';
import { ConnectivityMonitor } from './connectivity.js';
import { loadDevAiEnv } from './env.js';
import { CrashGuard } from './crash.js';
import { registerIpc, watchNativeTheme } from './ipc.js';
import { installApplicationMenu } from './menus.js';
import { createNativeBridge } from './native.js';
import { createNotifier } from './notifications.js';
import { OverlayWindow } from './overlay.js';
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
let overlay: OverlayWindow | null = null;
let manager: ServerManager | null = null;
let tray: AppTray | null = null;
let shortcuts: ShortcutRegistry | null = null;
let updates: UpdateManager | null = null;
let connectivity: ConnectivityMonitor | null = null;
let heartbeat: Heartbeat | null = null;
let stopNativeTheme: (() => void) | null = null;
let configStore: ConfigStore | null = null;
let quitting = false;
let listening = false;
let wakeWordOn = false;
let activeMode: OperatingMode = 'desktop';

const setListening = (next: boolean): void => {
  listening = next;
  tray?.setListening(next);
};

/** Sends a renderer event to every live window (main + overlay). */
const broadcast = (channel: string, payload?: unknown): void => {
  mainWindow?.send(channel, payload);
  overlay?.send(channel, payload);
};

/**
 * Switches the operating mode (Stage 12). Persists the choice, syncs every
 * window, and orchestrates the windows so switching feels instant (see
 * `planModeTransition`).
 */
const setMode = (raw: unknown): OperatingMode => {
  const { mode, route, showMain, hideMain, showOverlay } = planModeTransition(raw);
  activeMode = mode;
  void configStore?.set({ mode });
  tray?.setMode(mode);
  broadcast(IPC.modeChanged, mode);
  if (hideMain) {
    mainWindow?.hide();
  }
  if (showOverlay) {
    overlay?.show();
  } else {
    overlay?.hide();
  }
  if (showMain) {
    mainWindow?.focus();
    if (route) {
      mainWindow?.send(IPC.windowNavigate, route);
    }
  }
  return mode;
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
  loadDevAiEnv(app.getAppPath());
  const userData = app.getPath('userData');
  const dataDir = join(userData, 'data');
  const logDir = join(userData, 'logs');
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(logDir, { recursive: true });

  const config = new ConfigStore({ filePath: join(userData, 'config.json') });
  configStore = config;
  const secrets = new SecretStore({ filePath: join(userData, 'secrets.json') }).ensure();
  const notifier = createNotifier();
  const native = createNativeBridge();
  const crash = new CrashGuard({ logFile: join(logDir, 'crash.log') });

  await app.whenReady();

  // The renderer needs the microphone (voice input / wake word) and other
  // benign web permissions. Electron's default grants everything, but making
  // it explicit keeps media access working across Electron upgrades and
  // config changes (both a request handler and a sync check handler are
  // required for complete permission handling). We still deny the few
  // privacy-sensitive permissions the app never uses.
  const deniedPermissions = new Set(['geolocation', 'midi', 'midiSysex', 'clipboard-read']);
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(!deniedPermissions.has(permission));
  });
  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
    return !deniedPermissions.has(permission);
  });

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

  // Restore the persisted operating mode on launch: voice opens straight on
  // the hands-free surface, overlay mode can be reached from the tray.
  activeMode = normalizeOperatingMode(configState.mode);
  if (activeMode === 'voice') {
    mainWindow.instance?.webContents.once('did-finish-load', () => {
      mainWindow?.send(IPC.windowNavigate, '/voice');
    });
  }

  // Floating overlay (Stage 4): lazily created on first summon, hidden to the
  // tray when idle, bounds persisted to config on move/resize.
  overlay = new OverlayWindow({
    webUrl,
    preloadPath: join(__dirname, '..', 'preload', 'index.js'),
    apiBaseUrl,
    getBounds: () => configState.overlayBounds,
    saveBounds: (bounds) => {
      void config.set({ overlayBounds: bounds });
    },
    onVisibility: (visible) => {
      overlay?.send(IPC.overlayVisibility, visible);
    },
  });

  // Global hotkeys (Stage 3): user-configurable, applied from persisted config.
  // Stage 5 push-to-talk: Electron fires global shortcuts repeatedly while a
  // combo is held, so each repeat restarts a long safety timer. The renderer's
  // VAD ends the utterance on silence; the timer only guarantees a stuck "held"
  // state can never keep the mic open indefinitely.
  const PTT_HOLD_TIMEOUT_MS = 60_000;
  let pttHoldTimer: ReturnType<typeof setTimeout> | null = null;
  let pttActive = false;
  const pushToTalkHold = (): void => {
    if (!pttActive) {
      pttActive = true;
      broadcast(IPC.pushToTalkStart);
    }
    if (pttHoldTimer) {
      clearTimeout(pttHoldTimer);
    }
    pttHoldTimer = setTimeout(() => {
      pttActive = false;
      pttHoldTimer = null;
      broadcast(IPC.pushToTalkStop);
    }, PTT_HOLD_TIMEOUT_MS);
  };

  shortcuts = new ShortcutRegistry({
    onTriggered: (id) => {
      if (id === 'open-dashboard') {
        mainWindow?.focus();
        mainWindow?.send(IPC.windowNavigate, '/dashboard');
        return;
      }
      if (id === 'toggle-mic') {
        setListening(!listening);
        broadcast(IPC.micToggle);
        return;
      }
      if (id === 'open-overlay') {
        overlay?.toggle();
        return;
      }
      if (id === 'hide-overlay') {
        overlay?.hide();
        return;
      }
      if (id === 'push-to-talk') {
        pushToTalkHold();
        return;
      }
      broadcast(IPC.shortcutsTriggered, id);
    },
  });
  const shortcutResults = shortcuts.configure(configState.shortcuts);
  for (const [id, ok] of Object.entries(shortcutResults)) {
    if (!ok) {
      onLog(
        `shortcut ${id} could not be registered (${configState.shortcuts[id as ShortcutAction]})`,
      );
    }
  }

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
    overlay,
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
    mode: {
      get: () => activeMode,
      set: setMode,
    },
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
    wakeWord: () => wakeWordOn,
    mode: () => activeMode,
    onSetMode: setMode,
    onOpenDashboard: () => {
      mainWindow?.focus();
      mainWindow?.send(IPC.windowNavigate, '/dashboard');
    },
    onOpenOverlay: () => {
      overlay?.show();
    },
    onStartListening: () => {
      setListening(true);
      broadcast(IPC.listeningStart);
    },
    onStopListening: () => {
      setListening(false);
      broadcast(IPC.listeningStop);
    },
    onToggleWakeWord: () => {
      // The renderer persists the change through the config bridge; the tray
      // label is re-synced from config.onDidChange below and flipped locally
      // so it feels instant even if the renderer is not connected.
      wakeWordOn = !wakeWordOn;
      tray?.setWakeWord(wakeWordOn);
      broadcast(IPC.wakeWordSet, wakeWordOn);
    },
    onQuit: requestQuit,
  });
  tray.create(mainWindow);

  // Keep the tray's wake-word label in sync with the persisted settings
  // (the settings card / renderer writes through the config bridge).
  wakeWordOn = configState.voice.wakeWordEnabled;
  config.onDidChange((state) => {
    tray?.setWakeWord(state.voice.wakeWordEnabled);
  });

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
        overlay?.destroy();
        if (pttHoldTimer) {
          clearTimeout(pttHoldTimer);
        }
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

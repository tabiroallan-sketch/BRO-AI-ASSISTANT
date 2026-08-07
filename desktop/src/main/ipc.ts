import { ipcMain, nativeTheme, type BrowserWindow } from 'electron';
import {
  IPC,
  type DesktopConfig,
  type ServerReport,
  type ThemeSource,
} from '../shared/desktop-api.js';
import { ConfigStore } from './config.js';
import { ShortcutRegistry } from './shortcuts.js';
import { UpdateManager } from './updater.js';
import type { NativeBridge } from './native.js';
import type { Notifier } from './notifications.js';
import type { MainWindow } from './windows.js';

export type IpcDependencies = {
  config: ConfigStore;
  mainWindow: MainWindow;
  native: NativeBridge;
  shortcuts: ShortcutRegistry;
  updates: UpdateManager;
  servers: {
    getReports(): ServerReport[];
    restart(id: 'api' | 'web'): Promise<void>;
  };
  notifier: Notifier;
  appInfo: {
    name: string;
    version: string;
    isPackaged: boolean;
    versions: { electron: string; chrome: string; node: string };
  };
  autostart: {
    isEnabled(): Promise<boolean>;
    set(enabled: boolean, hidden?: boolean): Promise<void>;
  };
  network: { isOnline(): Promise<boolean> };
  theme: { getSource(): ThemeSource; setSource(source: ThemeSource): void };
  quit: () => void;
  getWindow: () => BrowserWindow | null;
};

const CONFIG_KEYS: ReadonlyArray<keyof DesktopConfig> = [
  'theme',
  'closeToTray',
  'launchAtLogin',
  'launchHidden',
  'autoCheckUpdates',
  'browserEnabled',
];

function sanitizeConfigPatch(raw: unknown): Partial<DesktopConfig> {
  if (typeof raw !== 'object' || raw === null) {
    return {};
  }
  const source = raw as Record<string, unknown>;
  const patch: Partial<DesktopConfig> = {};
  for (const key of CONFIG_KEYS) {
    const value = source[key];
    if (value === undefined) {
      continue;
    }
    if (key === 'theme') {
      if (value === 'system' || value === 'light' || value === 'dark') {
        patch.theme = value;
      }
    } else if (typeof value === 'boolean') {
      (patch as Record<string, unknown>)[key] = value;
    }
  }
  return patch;
}

/**
 * Registers every request/response channel with ipcMain. Event channels
 * (configChanged, updatesChanged, ...) are pushed from the services via
 * `broadcast`.
 */
export function registerIpc(deps: IpcDependencies): void {
  const broadcast = (channel: string, payload: unknown): void => {
    deps.mainWindow.send(channel, payload);
  };

  ipcMain.handle(IPC.configGet, () => deps.config.get());
  ipcMain.handle(IPC.configSet, async (_event, raw: unknown) => {
    const patch = sanitizeConfigPatch(raw);
    const next = await deps.config.set(patch);
    if (patch.launchAtLogin !== undefined) {
      await deps.autostart
        .set(patch.launchAtLogin, patch.launchHidden ?? true)
        .catch(() => undefined);
    }
    if (patch.theme !== undefined) {
      deps.theme.setSource(patch.theme);
    }
    broadcast(IPC.configChanged, next);
    return next;
  });

  ipcMain.handle(IPC.windowMinimize, () => deps.mainWindow.minimize());
  ipcMain.handle(IPC.windowToggleMaximize, () => deps.mainWindow.toggleMaximize());
  ipcMain.handle(IPC.windowClose, () => deps.mainWindow.close());
  ipcMain.handle(IPC.windowIsMaximized, () => deps.mainWindow.instance?.isMaximized() ?? false);
  ipcMain.handle(IPC.windowNavigate, (_event, path: string) =>
    deps.mainWindow.send(IPC.windowNavigate, path),
  );

  ipcMain.handle(IPC.shellOpenExternal, (_event, url: string) => deps.native.openExternal(url));
  ipcMain.handle(IPC.shellOpenPath, (_event, target: string) => deps.native.openPath(target));
  ipcMain.handle(IPC.dialogPickFile, () => deps.native.pickFile(deps.getWindow()));
  ipcMain.handle(IPC.clipboardRead, () => deps.native.readClipboardText());
  ipcMain.handle(IPC.clipboardWrite, (_event, text: string) =>
    deps.native.writeClipboardText(text),
  );

  ipcMain.handle(IPC.shortcutsRegister, (_event, id: string, accelerator: string) =>
    deps.shortcuts.registerOne({ id, accelerator }),
  );
  ipcMain.handle(IPC.shortcutsUnregister, (_event, id: string) => deps.shortcuts.unregisterOne(id));

  ipcMain.handle(IPC.autostartIsEnabled, () => deps.autostart.isEnabled());
  ipcMain.handle(IPC.autostartSet, (_event, enabled: boolean, hidden?: boolean) =>
    deps.autostart.set(enabled, hidden),
  );

  ipcMain.handle(IPC.updatesStatus, () => deps.updates.getStatus());
  ipcMain.handle(IPC.updatesCheck, () => deps.updates.check());
  ipcMain.handle(IPC.updatesDownload, () => deps.updates.download());
  ipcMain.handle(IPC.updatesInstall, () => deps.updates.install());

  ipcMain.handle(IPC.serversStatus, () => deps.servers.getReports());
  ipcMain.handle(IPC.serversRestart, (_event, id: 'api' | 'web') => deps.servers.restart(id));

  ipcMain.handle(IPC.notificationShow, (_event, title: string, body: string) =>
    deps.notifier.show(title, body),
  );

  ipcMain.handle(IPC.networkStatus, () => deps.network.isOnline());
  ipcMain.handle(IPC.themeGet, () => deps.theme.getSource());
}

export function watchNativeTheme(onChange: (shouldUseDark: boolean) => void): () => void {
  const listener = (): void => onChange(nativeTheme.shouldUseDarkColors);
  nativeTheme.on('updated', listener);
  return () => {
    nativeTheme.removeListener('updated', listener);
  };
}

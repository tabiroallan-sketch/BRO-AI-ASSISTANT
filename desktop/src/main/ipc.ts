import { ipcMain, nativeTheme, type BrowserWindow } from 'electron';
import {
  DEFAULT_SHORTCUTS,
  IPC,
  SHORTCUT_ACTIONS,
  SHORTCUT_LABELS,
  type DesktopConfig,
  type OperatingMode,
  type ServerReport,
  type ShortcutAction,
  type ShortcutBindings,
  type ShortcutSetResult,
  type ThemeSource,
  isOperatingMode,
  normalizeOperatingMode,
  normalizeVoiceSettings,
} from '../shared/desktop-api.js';
import { ConfigStore } from './config.js';
import { normalizeOverlayBounds } from './overlay-bounds.js';
import { findConflicts, validateAccelerator } from './shortcut-utils.js';
import { ShortcutRegistry } from './shortcuts.js';
import { UpdateManager } from './updater.js';
import type { NativeBridge } from './native.js';
import type { Notifier } from './notifications.js';
import type { OverlayWindow } from './overlay.js';
import type { MainWindow } from './windows.js';

export type IpcDependencies = {
  config: ConfigStore;
  mainWindow: MainWindow;
  overlay: OverlayWindow;
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
  mode: { get(): OperatingMode; set(mode: OperatingMode): OperatingMode };
  quit: () => void;
  getWindow: () => BrowserWindow | null;
};

const CONFIG_KEYS: ReadonlyArray<keyof DesktopConfig> = [
  'theme',
  'mode',
  'closeToTray',
  'launchAtLogin',
  'launchHidden',
  'autoCheckUpdates',
  'browserEnabled',
  'shortcuts',
  'overlayBounds',
  'voice',
];

function sanitizeShortcuts(value: unknown): ShortcutBindings | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const source = value as Record<string, unknown>;
  const next: ShortcutBindings = { ...DEFAULT_SHORTCUTS };
  let changed = false;
  for (const action of SHORTCUT_ACTIONS) {
    const raw = source[action];
    if (typeof raw === 'string') {
      next[action] = raw;
      changed = true;
    }
  }
  return changed ? next : undefined;
}

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
    } else if (key === 'mode') {
      if (isOperatingMode(value)) {
        patch.mode = value;
      }
    } else if (key === 'shortcuts') {
      const shortcuts = sanitizeShortcuts(value);
      if (shortcuts) {
        patch.shortcuts = shortcuts;
      }
    } else if (key === 'overlayBounds') {
      const bounds = normalizeOverlayBounds(value);
      if (bounds) {
        patch.overlayBounds = bounds;
      } else if (value === null) {
        patch.overlayBounds = null;
      }
    } else if (key === 'voice') {
      const voice = normalizeVoiceSettings(value);
      if (voice) {
        patch.voice = voice;
      }
    } else if (typeof value === 'boolean') {
      (patch as Record<string, unknown>)[key] = value;
    }
  }
  return patch;
}

/** The slice of IpcDependencies that shortcut mutation needs. */
export type SetShortcutDeps = {
  config: ConfigStore;
  mainWindow: { send: (channel: string, payload?: unknown) => void };
  shortcuts: ShortcutRegistry;
};

export async function setShortcut(
  deps: SetShortcutDeps,
  action: ShortcutAction,
  raw: string,
): Promise<ShortcutSetResult> {
  if (!SHORTCUT_ACTIONS.includes(action)) {
    return { ok: false, error: 'invalid', message: 'Unknown shortcut action.' };
  }
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  if (trimmed) {
    const validation = validateAccelerator(trimmed);
    if (!validation.ok) {
      return { ok: false, error: 'invalid', message: validation.reason };
    }
    const current = deps.shortcuts.getBindings() as ShortcutBindings;
    const candidate = { ...current, [action]: validation.accelerator };
    // findConflicts reports the later action in SHORTCUT_ACTIONS order, so the
    // action being set may appear on either side of a collision.
    const conflict = findConflicts(candidate).find(
      (entry) => entry.action === action || entry.conflictsWith === action,
    );
    if (conflict) {
      const other = conflict.action === action ? conflict.conflictsWith : conflict.action;
      return {
        ok: false,
        error: 'taken',
        message: `${SHORTCUT_LABELS[other]} already uses this shortcut.`,
        action: other,
      };
    }
    if (!deps.shortcuts.setBinding(action, validation.accelerator)) {
      return {
        ok: false,
        error: 'failed',
        message: 'Could not register this shortcut - it may be in use by another application.',
      };
    }
  } else {
    // Empty string disables the action.
    deps.shortcuts.setBinding(action, '');
  }
  const bindings = deps.shortcuts.getBindings() as ShortcutBindings;
  await deps.config.set({ shortcuts: bindings });
  deps.mainWindow.send(IPC.shortcutsChanged, bindings);
  return { ok: true, bindings };
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
  ipcMain.handle(IPC.windowShow, () => deps.mainWindow.focus());
  ipcMain.handle(IPC.windowIsMaximized, () => deps.mainWindow.instance?.isMaximized() ?? false);
  ipcMain.handle(IPC.windowNavigate, (_event, path: string) =>
    deps.mainWindow.send(IPC.windowNavigate, path),
  );
  ipcMain.handle(IPC.overlayToggle, () => deps.overlay.toggle());
  ipcMain.handle(IPC.overlayShow, () => deps.overlay.show());
  ipcMain.handle(IPC.overlayHide, () => deps.overlay.hide());
  ipcMain.handle(IPC.overlayResize, (_event, width: unknown, height: unknown) => {
    if (typeof width === 'number' && typeof height === 'number') {
      deps.overlay.resize(width, height);
    }
  });

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
  ipcMain.handle(IPC.shortcutsGet, () => deps.shortcuts.getBindings());
  ipcMain.handle(IPC.shortcutsSet, (_event, action: ShortcutAction, accelerator: string) =>
    setShortcut(deps, action, accelerator),
  );

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
  ipcMain.handle(IPC.modeGet, () => deps.mode.get());
  ipcMain.handle(IPC.modeSet, (_event, raw: unknown) => deps.mode.set(normalizeOperatingMode(raw)));
}

export function watchNativeTheme(onChange: (shouldUseDark: boolean) => void): () => void {
  const listener = (): void => onChange(nativeTheme.shouldUseDarkColors);
  nativeTheme.on('updated', listener);
  return () => {
    nativeTheme.removeListener('updated', listener);
  };
}

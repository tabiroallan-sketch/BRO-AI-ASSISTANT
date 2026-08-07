/**
 * Typed contract between the Electron main process (desktop/src/main),
 * the preload bridge (desktop/src/preload), and the web app
 * (web/src/lib/desktop.ts). This file is the single source of truth for the
 * IPC surface exposed to the renderer as `window.broDesktop`.
 *
 * The desktop shell is an additive layer: the web app keeps working in a
 * plain browser, where `window.broDesktop` is simply undefined.
 */

export type ThemeSource = 'system' | 'light' | 'dark';

export type DesktopConfig = {
  /** Theme source applied to nativeTheme and synced to the web app. */
  theme: ThemeSource;
  /** Closing the window hides it instead of quitting (tray keeps it alive). */
  closeToTray: boolean;
  /** Launch BRO automatically when the user logs into Windows. */
  launchAtLogin: boolean;
  /** When auto-launching, start hidden to the tray. */
  launchHidden: boolean;
  /** Poll the update feed and download releases automatically. */
  autoCheckUpdates: boolean;
  /** Enable the assistant's browser-automation tools (bundled Chromium). */
  browserEnabled: boolean;
};

export type UpdateState =
  | 'disabled'
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error';

export type UpdateStatus = {
  state: UpdateState;
  version?: string;
  percent?: number;
  message?: string;
};

export type ServiceState = 'starting' | 'running' | 'stopped' | 'error';

export type ServerReport = {
  id: 'postgres' | 'api' | 'web';
  state: ServiceState;
  port?: number;
  message?: string;
};

export type PickFileResult =
  { canceled: true } | { canceled: false; path: string; content: string };

/** Channels used for request/response (ipcRenderer.invoke). */
export const IPC = {
  configGet: 'bro:config:get',
  configSet: 'bro:config:set',
  configChanged: 'bro:config:changed',
  windowMinimize: 'bro:window:minimize',
  windowToggleMaximize: 'bro:window:toggle-maximize',
  windowClose: 'bro:window:close',
  windowIsMaximized: 'bro:window:is-maximized',
  windowMaximized: 'bro:window:maximized',
  windowNavigate: 'bro:window:navigate',
  micToggle: 'bro:mic:toggle',
  shellOpenExternal: 'bro:shell:open-external',
  shellOpenPath: 'bro:shell:open-path',
  dialogPickFile: 'bro:dialog:pick-file',
  clipboardRead: 'bro:clipboard:read',
  clipboardWrite: 'bro:clipboard:write',
  shortcutsRegister: 'bro:shortcuts:register',
  shortcutsUnregister: 'bro:shortcuts:unregister',
  shortcutsTriggered: 'bro:shortcuts:triggered',
  autostartIsEnabled: 'bro:autostart:is-enabled',
  autostartSet: 'bro:autostart:set',
  updatesStatus: 'bro:updates:status',
  updatesCheck: 'bro:updates:check',
  updatesDownload: 'bro:updates:download',
  updatesInstall: 'bro:updates:install',
  updatesChanged: 'bro:updates:changed',
  serversStatus: 'bro:servers:status',
  serversChanged: 'bro:servers:changed',
  serversRestart: 'bro:servers:restart',
  notificationShow: 'bro:notification:show',
  networkStatus: 'bro:network:status',
  networkChanged: 'bro:network:changed',
  themeGet: 'bro:theme:get',
  themeChanged: 'bro:theme:changed',
} as const;

/** The surface exposed to the renderer via contextBridge. */
export type DesktopApi = {
  readonly platform: NodeJS.Platform;
  readonly isPackaged: boolean;
  readonly versions: { electron: string; chrome: string; node: string };
  config: {
    get(): Promise<DesktopConfig>;
    set(patch: Partial<DesktopConfig>): Promise<DesktopConfig>;
    onChanged(callback: (config: DesktopConfig) => void): () => void;
  };
  window: {
    minimize(): void;
    toggleMaximize(): void;
    close(): void;
    isMaximized(): Promise<boolean>;
    onMaximized(callback: (maximized: boolean) => void): () => void;
    /** Ask the renderer to navigate (tray/hotkey shortcuts). */
    navigate(path: string): void;
  };
  commands: {
    /** Fired when a push-to-talk style command is requested (voice stage). */
    onMicToggle(callback: () => void): () => void;
  };
  shell: {
    openExternal(url: string): Promise<void>;
    openPath(target: string): Promise<string>;
  };
  dialog: {
    pickFile(): Promise<PickFileResult>;
  };
  clipboard: {
    readText(): Promise<string>;
    writeText(text: string): Promise<void>;
  };
  shortcuts: {
    register(id: string, accelerator: string): Promise<boolean>;
    unregister(id: string): Promise<void>;
    onTriggered(callback: (id: string) => void): () => void;
  };
  autostart: {
    isEnabled(): Promise<boolean>;
    set(enabled: boolean, hidden?: boolean): Promise<void>;
  };
  updates: {
    status(): Promise<UpdateStatus>;
    check(): Promise<UpdateStatus>;
    download(): Promise<void>;
    install(): Promise<void>;
    onStatus(callback: (status: UpdateStatus) => void): () => void;
  };
  servers: {
    status(): Promise<ServerReport[]>;
    restart(id: 'api' | 'web'): Promise<void>;
    onStatus(callback: (reports: ServerReport[]) => void): () => void;
  };
  notifications: {
    show(title: string, body: string): void;
  };
  network: {
    isOnline(): Promise<boolean>;
    onStatus(callback: (online: boolean) => void): () => void;
  };
  theme: {
    get(): Promise<ThemeSource>;
    onChange(callback: (shouldUseDark: boolean) => void): () => void;
  };
};

export const DEFAULT_DESKTOP_CONFIG: DesktopConfig = {
  theme: 'system',
  closeToTray: false,
  launchAtLogin: false,
  launchHidden: true,
  autoCheckUpdates: true,
  browserEnabled: false,
};

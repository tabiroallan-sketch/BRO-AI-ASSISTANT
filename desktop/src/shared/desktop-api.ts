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

/** Rectangle describing the overlay window's position and size. */
export type OverlayBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/** How the assistant accepts voice input (Stage 5). */
export type ListeningMode = 'off' | 'manual' | 'ptt';

/**
 * Voice preferences (Stage 5). Mirror of the settings card; persisted in the
 * desktop config when the shell is present, else the web app's localStorage.
 */
export type VoiceSettings = {
  /** off = never auto-start; manual = mic button / mic-toggle; ptt = hotkey. */
  listeningMode: ListeningMode;
  /** Preferred input device id from enumerateDevices, or null for default. */
  inputDeviceId: string | null;
  /** Preferred output device id, or null for default. */
  outputDeviceId: string | null;
  /** Speak assistant replies via speechSynthesis. */
  ttsEnabled: boolean;
  /** Preferred TTS voice URI, or null for the default voice. */
  ttsVoice: string | null;
  /** Speech rate 0.5..2. */
  ttsRate: number;
  /** Speech pitch 0..2. */
  ttsPitch: number;
  /** getUserMedia audio processing (all default on). */
  noiseSuppression: boolean;
  echoCancellation: boolean;
  autoGainControl: boolean;
};

export const VOICE_MODES: readonly ListeningMode[] = ['off', 'manual', 'ptt'];

export const VOICE_MODE_LABELS: Record<ListeningMode, string> = {
  off: 'Off',
  manual: 'Manual (click to talk)',
  ptt: 'Push-to-talk (hotkey)',
};

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  listeningMode: 'manual',
  inputDeviceId: null,
  outputDeviceId: null,
  ttsEnabled: true,
  ttsVoice: null,
  ttsRate: 1,
  ttsPitch: 1,
  noiseSuppression: true,
  echoCancellation: true,
  autoGainControl: true,
};

const VOICE_BOOLEAN_KEYS = [
  'ttsEnabled',
  'noiseSuppression',
  'echoCancellation',
  'autoGainControl',
] as const;

function nullableString(value: unknown): string | null | undefined {
  if (value === null || value === undefined) {
    return null;
  }
  return typeof value === 'string' ? value : undefined;
}

/** Validates an arbitrary persisted value into VoiceSettings, or undefined. */
export function normalizeVoiceSettings(raw: unknown): VoiceSettings | undefined {
  if (typeof raw !== 'object' || raw === null) {
    return undefined;
  }
  const source = raw as Record<string, unknown>;
  if (!VOICE_MODES.includes(source.listeningMode as ListeningMode)) {
    return undefined;
  }
  for (const key of VOICE_BOOLEAN_KEYS) {
    if (typeof source[key] !== 'boolean') {
      return undefined;
    }
  }
  if (typeof source.ttsRate !== 'number' || !Number.isFinite(source.ttsRate)) {
    return undefined;
  }
  if (typeof source.ttsPitch !== 'number' || !Number.isFinite(source.ttsPitch)) {
    return undefined;
  }
  const inputDeviceId = nullableString(source.inputDeviceId);
  const outputDeviceId = nullableString(source.outputDeviceId);
  const ttsVoice = nullableString(source.ttsVoice);
  if (inputDeviceId === undefined || outputDeviceId === undefined || ttsVoice === undefined) {
    return undefined;
  }
  return {
    listeningMode: source.listeningMode as ListeningMode,
    inputDeviceId,
    outputDeviceId,
    ttsEnabled: source.ttsEnabled as boolean,
    ttsVoice,
    ttsRate: Math.round(Math.min(2, Math.max(0.5, source.ttsRate)) * 100) / 100,
    ttsPitch: Math.round(Math.min(2, Math.max(0, source.ttsPitch)) * 100) / 100,
    noiseSuppression: source.noiseSuppression as boolean,
    echoCancellation: source.echoCancellation as boolean,
    autoGainControl: source.autoGainControl as boolean,
  };
}

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
  /** Global shortcut bindings, per action. */
  shortcuts: ShortcutBindings;
  /** Last position/size of the floating overlay window, or null to auto-place. */
  overlayBounds: OverlayBounds | null;
  /** Voice preferences (input device, listening mode, TTS). */
  voice: VoiceSettings;
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

export type ServiceId = 'postgres' | 'api' | 'web';

export type ServerReport = {
  id: ServiceId;
  state: ServiceState;
  port?: number;
  message?: string;
};

export type ShortcutAction =
  'open-overlay' | 'hide-overlay' | 'push-to-talk' | 'open-dashboard' | 'toggle-mic';

/** Accelerator per action; an empty string disables the shortcut. */
export type ShortcutBindings = Record<ShortcutAction, string>;

export const SHORTCUT_ACTIONS: readonly ShortcutAction[] = [
  'open-overlay',
  'hide-overlay',
  'push-to-talk',
  'open-dashboard',
  'toggle-mic',
];

export const SHORTCUT_LABELS: Record<ShortcutAction, string> = {
  'open-overlay': 'Open overlay',
  'hide-overlay': 'Hide overlay',
  'push-to-talk': 'Push-to-talk',
  'open-dashboard': 'Open dashboard',
  'toggle-mic': 'Toggle microphone',
};

/**
 * Default global shortcuts. Push-to-talk uses Alt+P rather than a bare "Alt"
 * because the OS refuses to hand a lone modifier to globalShortcut; Stage 5
 * builds the real hold-to-talk pipeline on top of this trigger.
 */
export const DEFAULT_SHORTCUTS: ShortcutBindings = {
  'open-overlay': 'CommandOrControl+Space',
  'hide-overlay': 'Escape',
  'push-to-talk': 'Alt+P',
  'open-dashboard': 'CommandOrControl+Shift+B',
  'toggle-mic': 'CommandOrControl+Shift+M',
};

export type ShortcutSetResult =
  | { ok: true; bindings: ShortcutBindings }
  | {
      ok: false;
      error: 'invalid' | 'taken' | 'failed';
      message: string;
      /** The action that already owns the accelerator (for 'taken'). */
      action?: ShortcutAction;
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
  windowShow: 'bro:window:show',
  windowNavigate: 'bro:window:navigate',
  micToggle: 'bro:mic:toggle',
  overlayToggle: 'bro:overlay:toggle',
  overlayShow: 'bro:overlay:show',
  overlayHide: 'bro:overlay:hide',
  overlayResize: 'bro:overlay:resize',
  overlayVisibility: 'bro:overlay:visibility',
  listeningStart: 'bro:listening:start',
  listeningStop: 'bro:listening:stop',
  pushToTalkStart: 'bro:push-to-talk:start',
  pushToTalkStop: 'bro:push-to-talk:stop',
  shellOpenExternal: 'bro:shell:open-external',
  shellOpenPath: 'bro:shell:open-path',
  dialogPickFile: 'bro:dialog:pick-file',
  clipboardRead: 'bro:clipboard:read',
  clipboardWrite: 'bro:clipboard:write',
  shortcutsRegister: 'bro:shortcuts:register',
  shortcutsUnregister: 'bro:shortcuts:unregister',
  shortcutsTriggered: 'bro:shortcuts:triggered',
  shortcutsGet: 'bro:shortcuts:get',
  shortcutsSet: 'bro:shortcuts:set',
  shortcutsChanged: 'bro:shortcuts:changed',
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
    /** Bring the main window to the front (from the overlay, etc.). */
    show(): void;
    /** Ask the renderer to navigate (tray/hotkey shortcuts). */
    navigate(path: string): void;
  };
  commands: {
    /** Fired when a push-to-talk style command is requested (voice stage). */
    onMicToggle(callback: () => void): () => void;
    /** Fired when the tray/user asks listening to begin (voice stage). */
    onListeningStart(callback: () => void): () => void;
    /** Fired when the tray/user asks listening to stop (voice stage). */
    onListeningStop(callback: () => void): () => void;
    /** Fired while push-to-talk is held (Stage 5 builds the audio capture). */
    onPushToTalkStart(callback: () => void): () => void;
    /** Fired when push-to-talk is released. */
    onPushToTalkStop(callback: () => void): () => void;
  };
  overlay: {
    /** Ask the shell to toggle the floating overlay window. */
    toggle(): void;
    /** Ask the shell to show the floating overlay window (instant summon). */
    show(): void;
    /** Ask the shell to hide the floating overlay window (Esc / hotkey). */
    hide(): void;
    /** Resize the overlay window, keeping its top-left corner fixed. */
    resize(width: number, height: number): void;
    /** Fired when the shell shows/hides the overlay window. */
    onVisibility(callback: (visible: boolean) => void): () => void;
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
    /** Current accelerator per action. */
    get(): Promise<ShortcutBindings>;
    /**
     * Rebind an action. Returns `ok:false` with `error:'taken'` on an
     * in-app conflict or `error:'failed'` when the OS refused registration.
     */
    set(action: ShortcutAction, accelerator: string): Promise<ShortcutSetResult>;
    onChanged(callback: (bindings: ShortcutBindings) => void): () => void;
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
  shortcuts: { ...DEFAULT_SHORTCUTS },
  overlayBounds: null,
  voice: { ...DEFAULT_VOICE_SETTINGS },
};

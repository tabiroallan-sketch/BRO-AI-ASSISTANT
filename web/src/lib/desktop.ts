import {
  DEFAULT_DESKTOP_CONFIG,
  DEFAULT_SHORTCUTS,
  DEFAULT_VOICE_SETTINGS,
  OPERATING_MODE_LABELS,
  OPERATING_MODES,
  SHORTCUT_ACTIONS,
  SHORTCUT_LABELS,
  VOICE_MODE_LABELS,
  VOICE_MODES,
  WAKE_WORD_DEFAULT_PHRASES,
  WAKE_WORD_MAX_PHRASES,
  WAKE_WORD_MAX_PHRASE_LENGTH,
  WAKE_WORD_MAX_SENSITIVITY,
  WAKE_WORD_MIN_SENSITIVITY,
  isOperatingMode,
  normalizeOperatingMode,
  normalizeVoiceSettings,
  normalizeWakePhrases,
  normalizeWakeSensitivity,
  type DesktopApi,
  type DesktopConfig,
  type ListeningMode,
  type OperatingMode,
  type OverlayBounds,
  type ShortcutAction,
  type ShortcutBindings,
  type ShortcutSetResult,
  type VoiceSettings,
} from './desktop-api';

export {
  DEFAULT_DESKTOP_CONFIG,
  DEFAULT_SHORTCUTS,
  DEFAULT_VOICE_SETTINGS,
  OPERATING_MODE_LABELS,
  OPERATING_MODES,
  SHORTCUT_ACTIONS,
  SHORTCUT_LABELS,
  VOICE_MODE_LABELS,
  VOICE_MODES,
  WAKE_WORD_DEFAULT_PHRASES,
  WAKE_WORD_MAX_PHRASES,
  WAKE_WORD_MAX_PHRASE_LENGTH,
  WAKE_WORD_MAX_SENSITIVITY,
  WAKE_WORD_MIN_SENSITIVITY,
  isOperatingMode,
  normalizeOperatingMode,
  normalizeVoiceSettings,
  normalizeWakePhrases,
  normalizeWakeSensitivity,
  type DesktopApi,
  type DesktopConfig,
  type ListeningMode,
  type OperatingMode,
  type OverlayBounds,
  type ShortcutAction,
  type ShortcutBindings,
  type ShortcutSetResult,
  type VoiceSettings,
};

declare global {
  interface Window {
    broDesktop?: DesktopApi;
  }
}

/** Inert subscription: subscribes but never fires, returning a no-op unsubscribe. */
const NOOP_SUBSCRIBE = (): (() => void) => () => {};

/**
 * Full no-op implementation of the bridge. It fills any gaps in a partial or
 * stale `window.broDesktop` (for example, when the compiled preload predates
 * an API added to the source), so a missing method can never take down a whole
 * page with an uncaught exception. Getters resolve benign defaults and
 * subscriptions are inert; only present, real members actually run.
 */
const NOOP_API: DesktopApi = {
  platform: (typeof process !== 'undefined' && process.platform
    ? process.platform
    : 'win32') as NodeJS.Platform,
  isPackaged: false,
  versions: { electron: '', chrome: '', node: '' },
  config: {
    get: async () => ({ ...DEFAULT_DESKTOP_CONFIG }),
    set: async (patch) => ({ ...DEFAULT_DESKTOP_CONFIG, ...patch }),
    onChanged: NOOP_SUBSCRIBE,
  },
  window: {
    minimize: () => {},
    toggleMaximize: () => {},
    close: () => {},
    isMaximized: async () => false,
    onMaximized: NOOP_SUBSCRIBE,
    show: () => {},
    navigate: () => {},
    onNavigate: NOOP_SUBSCRIBE,
  },
  commands: {
    onMicToggle: NOOP_SUBSCRIBE,
    onListeningStart: NOOP_SUBSCRIBE,
    onListeningStop: NOOP_SUBSCRIBE,
    onPushToTalkStart: NOOP_SUBSCRIBE,
    onPushToTalkStop: NOOP_SUBSCRIBE,
    onWakeWordSet: NOOP_SUBSCRIBE,
  },
  overlay: {
    toggle: () => {},
    show: () => {},
    hide: () => {},
    resize: () => {},
    onVisibility: NOOP_SUBSCRIBE,
  },
  shell: {
    openExternal: async () => {},
    openPath: async () => '',
  },
  dialog: {
    pickFile: async () => ({ canceled: true }),
  },
  clipboard: {
    readText: async () => '',
    writeText: async () => {},
  },
  shortcuts: {
    register: async () => false,
    unregister: async () => {},
    onTriggered: NOOP_SUBSCRIBE,
    get: async () => ({ ...DEFAULT_SHORTCUTS }),
    set: async () => ({ ok: false, error: 'failed', message: 'Desktop bridge unavailable.' }),
    onChanged: NOOP_SUBSCRIBE,
  },
  autostart: {
    isEnabled: async () => false,
    set: async () => {},
  },
  updates: {
    status: async () => ({ state: 'disabled' }),
    check: async () => ({ state: 'disabled' }),
    download: async () => {},
    install: async () => {},
    onStatus: NOOP_SUBSCRIBE,
  },
  servers: {
    status: async () => [],
    restart: async () => {},
    onStatus: NOOP_SUBSCRIBE,
  },
  notifications: {
    show: () => {},
  },
  network: {
    isOnline: async () => true,
    onStatus: NOOP_SUBSCRIBE,
  },
  theme: {
    get: async () => 'system',
    onChange: NOOP_SUBSCRIBE,
  },
  mode: {
    get: async () => 'desktop',
    set: async (mode) => mode,
    onChanged: NOOP_SUBSCRIBE,
  },
};

/**
 * Returns the desktop bridge, or null when running in a plain browser.
 *
 * When `window.broDesktop` is present but missing members (e.g. a preload that
 * is out of sync with the shared contract), the missing pieces are replaced
 * with inert no-op implementations so callers can always rely on the full
 * `DesktopApi` surface. Present members always take precedence.
 */
export function getDesktopApi(): DesktopApi | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const raw = window.broDesktop;
  if (!raw) {
    return null;
  }
  // Start from the full no-op surface and let the real bridge's members win;
  // then deep-merge each group so a partially-present group (e.g. a stale
  // preload missing `onChanged`) keeps its real methods and fills the gaps.
  const merged = { ...NOOP_API, ...raw } as DesktopApi;
  const mutable = merged as Record<keyof DesktopApi, unknown>;
  for (const key of Object.keys(NOOP_API) as (keyof DesktopApi)[]) {
    const real = raw[key];
    if (typeof real !== 'object' || real === null) {
      continue;
    }
    const noop = NOOP_API[key];
    mutable[key] = { ...(noop as object), ...(real as object) };
  }
  return merged;
}

const MODIFIER_DISPLAY: Record<string, string> = {
  CommandOrControl: 'Ctrl/⌘',
  Command: '⌘',
  Control: 'Ctrl',
  Alt: 'Alt',
  AltGr: 'AltGr',
  Shift: 'Shift',
  Super: 'Win/⌘',
};

/** Renders an accelerator for humans: "Ctrl/⌘ + Shift + B". */
export function formatAccelerator(accelerator: string): string {
  if (!accelerator) {
    return 'Disabled';
  }
  return accelerator
    .split('+')
    .map((part) => MODIFIER_DISPLAY[part] ?? part)
    .join(' + ');
}

function mapKey(key: string): string {
  if (key === ' ') {
    return 'Space';
  }
  if (key === 'Escape') {
    return 'Escape';
  }
  if (key.length === 1) {
    return key.toUpperCase();
  }
  const named: Record<string, string> = {
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    PageUp: 'PageUp',
    PageDown: 'PageDown',
    Home: 'Home',
    End: 'End',
    Insert: 'Insert',
    Delete: 'Delete',
    Backspace: 'Backspace',
    Tab: 'Tab',
    Enter: 'Enter',
    F1: 'F1',
  };
  return named[key] ?? key;
}

/**
 * Builds an Electron accelerator string from a keydown event, or '' while the
 * user has only pressed a modifier (we wait for the real key to land).
 */
export function acceleratorFromEvent(event: KeyboardEvent): string {
  const key = event.key;
  if (!key || key === 'Dead' || key === 'Process' || key === 'Unidentified') {
    return '';
  }
  if (['Control', 'Shift', 'Alt', 'Meta', 'AltGraph'].includes(key)) {
    return '';
  }
  const parts: string[] = [];
  if (event.ctrlKey || event.metaKey) {
    parts.push('CommandOrControl');
  }
  if (event.altKey) {
    parts.push('Alt');
  }
  if (event.shiftKey) {
    parts.push('Shift');
  }
  const mapped = mapKey(key);
  if (!mapped) {
    return '';
  }
  parts.push(mapped);
  return parts.join('+');
}

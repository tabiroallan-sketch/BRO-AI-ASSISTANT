import {
  DEFAULT_SHORTCUTS,
  DEFAULT_VOICE_SETTINGS,
  SHORTCUT_ACTIONS,
  SHORTCUT_LABELS,
  VOICE_MODE_LABELS,
  VOICE_MODES,
  WAKE_WORD_DEFAULT_PHRASES,
  WAKE_WORD_MAX_PHRASES,
  WAKE_WORD_MAX_PHRASE_LENGTH,
  WAKE_WORD_MAX_SENSITIVITY,
  WAKE_WORD_MIN_SENSITIVITY,
  normalizeVoiceSettings,
  normalizeWakePhrases,
  normalizeWakeSensitivity,
  type DesktopApi,
  type ListeningMode,
  type OverlayBounds,
  type ShortcutAction,
  type ShortcutBindings,
  type ShortcutSetResult,
  type VoiceSettings,
} from '../../../desktop/src/shared/desktop-api';

export {
  DEFAULT_SHORTCUTS,
  DEFAULT_VOICE_SETTINGS,
  SHORTCUT_ACTIONS,
  SHORTCUT_LABELS,
  VOICE_MODE_LABELS,
  VOICE_MODES,
  WAKE_WORD_DEFAULT_PHRASES,
  WAKE_WORD_MAX_PHRASES,
  WAKE_WORD_MAX_PHRASE_LENGTH,
  WAKE_WORD_MAX_SENSITIVITY,
  WAKE_WORD_MIN_SENSITIVITY,
  normalizeVoiceSettings,
  normalizeWakePhrases,
  normalizeWakeSensitivity,
  type DesktopApi,
  type ListeningMode,
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

/** Returns the desktop bridge, or null when running in a plain browser. */
export function getDesktopApi(): DesktopApi | null {
  if (typeof window === 'undefined') {
    return null;
  }
  return window.broDesktop ?? null;
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

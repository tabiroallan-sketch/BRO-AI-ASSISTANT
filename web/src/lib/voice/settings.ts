/**
 * Voice settings persistence (Stage 5).
 *
 * The desktop config (via the preload bridge) is the source of truth when the
 * app runs inside Electron; localStorage is the fallback for browser builds.
 * Values are always normalized through `normalizeVoiceSettings` so the store
 * can never hold a malformed `VoiceSettings` object.
 */

import { getDesktopApi, normalizeVoiceSettings, DEFAULT_VOICE_SETTINGS } from '@/lib/desktop';
import type { VoiceSettings } from '@/lib/desktop';

const STORAGE_KEY = 'bro.voice.settings.v1';

let cached: VoiceSettings | null = null;

function readLocal(): VoiceSettings | null {
  if (typeof localStorage === 'undefined') {
    return null;
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    return normalizeVoiceSettings(JSON.parse(raw)) ?? null;
  } catch {
    return null;
  }
}

function writeLocal(settings: VoiceSettings): void {
  if (typeof localStorage === 'undefined') {
    return;
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage unavailable (private mode / quota); cache still holds the value.
  }
}

/** Synchronous, already-loaded settings (defaults until init runs). */
export function currentVoiceSettings(): VoiceSettings {
  if (!cached) {
    cached = readLocal() ?? { ...DEFAULT_VOICE_SETTINGS };
  }
  return cached;
}

/** Loads desktop config voice settings, falling back to local storage. */
export async function initVoiceSettings(): Promise<VoiceSettings> {
  const api = getDesktopApi();
  if (api) {
    try {
      const config = await api.config.get();
      const voice = normalizeVoiceSettings(config.voice) ?? { ...DEFAULT_VOICE_SETTINGS };
      cached = voice;
      return voice;
    } catch {
      // Desktop config read failed; fall through to local/default values.
    }
  }
  return currentVoiceSettings();
}

/** Applies a partial update, persists to local + desktop config (best effort). */
export async function saveVoiceSettings(patch: Partial<VoiceSettings>): Promise<VoiceSettings> {
  const next = normalizeVoiceSettings({ ...currentVoiceSettings(), ...patch }) ?? {
    ...currentVoiceSettings(),
    ...patch,
  };
  cached = next;
  writeLocal(next);
  const api = getDesktopApi();
  if (api) {
    try {
      await api.config.set({ voice: next });
    } catch {
      // Desktop config write failed; local cache still holds the value.
    }
  }
  return next;
}

/**
 * Applies voice settings that changed in another window (via the desktop
 * config broadcast) without re-persisting them.
 */
export function applyExternalVoiceSettings(settings: VoiceSettings): VoiceSettings {
  const next = normalizeVoiceSettings(settings) ?? currentVoiceSettings();
  cached = next;
  return next;
}

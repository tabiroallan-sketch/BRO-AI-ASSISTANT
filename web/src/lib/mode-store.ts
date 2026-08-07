'use client';

import { create } from 'zustand';
import { getDesktopApi, normalizeOperatingMode, type OperatingMode } from '@/lib/desktop';

const STORAGE_KEY = 'bro.mode.v1';

/** The web route that best represents each operating mode (browser fallback). */
export const MODE_ROUTES: Record<OperatingMode, string> = {
  desktop: '/dashboard',
  overlay: '/overlay',
  voice: '/voice',
};

export function modeRoute(mode: OperatingMode): string {
  return MODE_ROUTES[mode];
}

type ModeStore = {
  mode: OperatingMode;
  /** True once the persisted/desktop mode has been loaded and sync is wired. */
  ready: boolean;
  /** Switch the mode: persists locally and, when the shell is present, asks
   *  the desktop to orchestrate the windows. The broadcast back applies the
   *  same value, which is a no-op. */
  setMode: (mode: OperatingMode) => void;
  /** Apply a mode that changed in another window / the tray / the shell. */
  applyExternal: (mode: OperatingMode) => void;
};

function readStoredMode(): OperatingMode {
  if (typeof window === 'undefined') {
    return 'desktop';
  }
  try {
    return normalizeOperatingMode(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return 'desktop';
  }
}

function persistMode(mode: OperatingMode): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Ignore quota/security errors; the mode still applies for this session.
  }
}

export const useModeStore = create<ModeStore>((set) => ({
  mode: readStoredMode(),
  ready: false,
  setMode: (mode) => {
    persistMode(mode);
    set({ mode });
    const api = getDesktopApi();
    if (api) {
      void api.mode.set(mode);
    }
  },
  applyExternal: (mode) => set({ mode }),
}));

/**
 * Loads the persisted mode and keeps the store in sync with the desktop shell
 * (mode changes made in the other window, via the tray, or on startup). Safe
 * to call from multiple components; subscriptions are idempotent. Returns an
 * unsubscribe function.
 */
export function initModeSync(): () => void {
  const store = useModeStore;
  const api = getDesktopApi();
  if (!api) {
    // Plain browser: the localStorage value is already the store's initial
    // state, so there is nothing to watch.
    store.setState({ ready: true });
    return () => {};
  }

  void api.mode.get().then((mode) => {
    store.setState({ mode, ready: true });
    persistMode(mode);
  });

  const offMode = api.mode.onChanged((mode) => {
    store.getState().applyExternal(mode);
    persistMode(mode);
  });
  const offConfig = api.config.onChanged((config) => {
    const mode = normalizeOperatingMode(config.mode);
    store.getState().applyExternal(mode);
    persistMode(mode);
  });
  return () => {
    offMode();
    offConfig();
  };
}

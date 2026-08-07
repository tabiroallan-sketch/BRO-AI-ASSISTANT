'use client';

import * as React from 'react';
import { initModeSync, useModeStore } from '@/lib/mode-store';
import type { OperatingMode } from '@/lib/desktop';

export type UseOperatingModeResult = {
  mode: OperatingMode;
  ready: boolean;
  setMode: (mode: OperatingMode) => void;
};

/**
 * The active operating mode (Stage 12). Shared across every window: persists
 * to the desktop config, syncs over the IPC broadcast (and localStorage in a
 * plain browser), so the same mode is shown everywhere and switching from one
 * surface updates all of them instantly.
 */
export function useOperatingMode(): UseOperatingModeResult {
  const mode = useModeStore((store) => store.mode);
  const ready = useModeStore((store) => store.ready);
  const setMode = useModeStore((store) => store.setMode);

  React.useEffect(() => initModeSync(), []);

  return { mode, ready, setMode };
}

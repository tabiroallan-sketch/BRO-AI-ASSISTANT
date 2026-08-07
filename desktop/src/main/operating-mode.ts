import { normalizeOperatingMode, type OperatingMode } from '../shared/desktop-api.js';

export type ModeTransition = {
  mode: OperatingMode;
  /** Route to push in the main window, or null to leave it alone. */
  route: string | null;
  /** Bring the main window up (focus). */
  showMain: boolean;
  /** Hide the main window (overlay mode is immersive). */
  hideMain: boolean;
  /** Show the floating overlay (desktop mode/voice hide it). */
  showOverlay: boolean;
};

/**
 * Plans a mode switch (Stage 12). Pure, so the desktop shell can be
 * unit-tested without a running Electron instance:
 *
 * - desktop → main window focused on the dashboard, overlay hidden;
 * - overlay → floating glass window summoned, main window hidden;
 * - voice   → main window focused on the hands-free surface, overlay hidden.
 */
export function planModeTransition(raw: unknown): ModeTransition {
  const mode = normalizeOperatingMode(raw);
  if (mode === 'overlay') {
    return { mode, route: null, showMain: false, hideMain: true, showOverlay: true };
  }
  if (mode === 'voice') {
    return { mode, route: '/voice', showMain: true, hideMain: false, showOverlay: false };
  }
  return { mode, route: '/dashboard', showMain: true, hideMain: false, showOverlay: false };
}

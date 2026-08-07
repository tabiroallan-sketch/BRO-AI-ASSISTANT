/**
 * Pure helpers for the floating overlay (Stage 4). Kept free of the desktop
 * bridge so the logic is testable and the overlay page also renders in a plain
 * browser (where the resize handle is hidden anyway).
 */

export const OVERLAY_MIN_WIDTH = 300;
export const OVERLAY_MIN_HEIGHT = 240;
export const OVERLAY_MAX_WIDTH = 1600;
export const OVERLAY_MAX_HEIGHT = 2000;

/** Clamps a requested overlay size to the allowed range. */
export function clampOverlaySize(width: number, height: number): { width: number; height: number } {
  return {
    width: Math.min(OVERLAY_MAX_WIDTH, Math.max(OVERLAY_MIN_WIDTH, Math.round(width))),
    height: Math.min(OVERLAY_MAX_HEIGHT, Math.max(OVERLAY_MIN_HEIGHT, Math.round(height))),
  };
}

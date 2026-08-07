import type { OverlayBounds } from '../shared/desktop-api.js';

export type Rect = { x: number; y: number; width: number; height: number };

export const OVERLAY_MIN_WIDTH = 300;
export const OVERLAY_MIN_HEIGHT = 240;
export const OVERLAY_MAX_WIDTH = 1600;
export const OVERLAY_MAX_HEIGHT = 2000;

const DEFAULT_WIDTH = 420;
const DEFAULT_HEIGHT = 600;

/**
 * A centered, reasonably-sized overlay on the given work area (typically the
 * display under the cursor). Used when the user has never positioned the
 * overlay before.
 */
export function defaultOverlayBounds(workArea: Rect): OverlayBounds {
  const width = Math.min(DEFAULT_WIDTH, workArea.width);
  const height = Math.min(DEFAULT_HEIGHT, workArea.height);
  return {
    x: workArea.x + Math.round((workArea.width - width) / 2),
    y: workArea.y + Math.round((workArea.height - height) / 2),
    width,
    height,
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Validates an arbitrary persisted value into an OverlayBounds, or undefined. */
export function normalizeOverlayBounds(raw: unknown): OverlayBounds | undefined {
  if (typeof raw !== 'object' || raw === null) {
    return undefined;
  }
  const source = raw as Record<string, unknown>;
  const { x, y, width, height } = source;
  if (
    !isFiniteNumber(x) ||
    !isFiniteNumber(y) ||
    !isFiniteNumber(width) ||
    !isFiniteNumber(height)
  ) {
    return undefined;
  }
  const clampedWidth = Math.min(OVERLAY_MAX_WIDTH, Math.max(OVERLAY_MIN_WIDTH, Math.round(width)));
  const clampedHeight = Math.min(
    OVERLAY_MAX_HEIGHT,
    Math.max(OVERLAY_MIN_HEIGHT, Math.round(height)),
  );
  if (clampedWidth !== width || clampedHeight !== height) {
    return undefined;
  }
  return { x: Math.round(x), y: Math.round(y), width: clampedWidth, height: clampedHeight };
}

/**
 * Keeps the overlay fully visible inside a work area, shrinking and nudging it
 * back into view if the display configuration changed since it was saved.
 */
export function clampOverlayBounds(bounds: OverlayBounds, workArea: Rect): OverlayBounds {
  const width = Math.min(OVERLAY_MAX_WIDTH, Math.max(OVERLAY_MIN_WIDTH, bounds.width));
  const height = Math.min(OVERLAY_MAX_HEIGHT, Math.max(OVERLAY_MIN_HEIGHT, bounds.height));
  const maxX = workArea.x + workArea.width - width;
  const maxY = workArea.y + workArea.height - height;
  return {
    width,
    height,
    x: Math.min(Math.max(bounds.x, workArea.x), Math.max(maxX, workArea.x)),
    y: Math.min(Math.max(bounds.y, workArea.y), Math.max(maxY, workArea.y)),
  };
}

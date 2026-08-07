import { describe, expect, it } from 'vitest';
import {
  OVERLAY_MAX_HEIGHT,
  OVERLAY_MAX_WIDTH,
  OVERLAY_MIN_HEIGHT,
  OVERLAY_MIN_WIDTH,
  clampOverlayBounds,
  defaultOverlayBounds,
  normalizeOverlayBounds,
} from '../src/main/overlay-bounds.js';

const WORK_AREA = { x: 0, y: 0, width: 1920, height: 1080 };

describe('defaultOverlayBounds', () => {
  it('centers a 420x600 overlay on the work area', () => {
    expect(defaultOverlayBounds(WORK_AREA)).toEqual({ x: 750, y: 240, width: 420, height: 600 });
  });

  it('shrinks to fit a smaller work area', () => {
    const bounds = defaultOverlayBounds({ x: 0, y: 0, width: 320, height: 300 });
    expect(bounds.width).toBe(320);
    expect(bounds.height).toBe(300);
    expect(bounds.x).toBe(0);
    expect(bounds.y).toBe(0);
  });

  it('respects a work area that is not at the origin', () => {
    const bounds = defaultOverlayBounds({ x: 1920, y: 0, width: 1280, height: 720 });
    expect(bounds.x).toBe(1920 + (1280 - 420) / 2);
    expect(bounds.y).toBe(0 + (720 - 600) / 2);
  });
});

describe('normalizeOverlayBounds', () => {
  it('returns undefined for non-objects', () => {
    expect(normalizeOverlayBounds(null)).toBeUndefined();
    expect(normalizeOverlayBounds('42')).toBeUndefined();
    expect(normalizeOverlayBounds(undefined)).toBeUndefined();
  });

  it('rejects missing or non-finite fields', () => {
    expect(normalizeOverlayBounds({ x: 1, y: 2, width: 300 })).toBeUndefined();
    expect(normalizeOverlayBounds({ x: 1, y: 2, width: 300, height: Number.NaN })).toBeUndefined();
    expect(normalizeOverlayBounds({ x: 1, y: 2, width: 300, height: Infinity })).toBeUndefined();
    expect(normalizeOverlayBounds({ x: '1', y: 2, width: 300, height: 240 })).toBeUndefined();
  });

  it('rejects sizes outside the supported range', () => {
    expect(normalizeOverlayBounds({ x: 0, y: 0, width: 200, height: 240 })).toBeUndefined();
    expect(normalizeOverlayBounds({ x: 0, y: 0, width: 300, height: 100 })).toBeUndefined();
    expect(normalizeOverlayBounds({ x: 0, y: 0, width: 5000, height: 240 })).toBeUndefined();
  });

  it('accepts a valid bounds object', () => {
    expect(normalizeOverlayBounds({ x: 10.4, y: 20.6, width: 420, height: 600 })).toEqual({
      x: 10,
      y: 21,
      width: 420,
      height: 600,
    });
  });
});

describe('clampOverlayBounds', () => {
  it('leaves an on-screen bounds untouched', () => {
    const bounds = { x: 100, y: 100, width: 420, height: 600 };
    expect(clampOverlayBounds(bounds, WORK_AREA)).toEqual(bounds);
  });

  it('clamps size to the overlay min/max', () => {
    expect(clampOverlayBounds({ x: 0, y: 0, width: 50, height: 50 }, WORK_AREA)).toMatchObject({
      width: OVERLAY_MIN_WIDTH,
      height: OVERLAY_MIN_HEIGHT,
    });
    expect(clampOverlayBounds({ x: 0, y: 0, width: 5000, height: 5000 }, WORK_AREA)).toMatchObject({
      width: OVERLAY_MAX_WIDTH,
      height: OVERLAY_MAX_HEIGHT,
    });
  });

  it('nudges the overlay back on-screen when it drifted off', () => {
    const bounds = clampOverlayBounds({ x: -500, y: -500, width: 420, height: 600 }, WORK_AREA);
    expect(bounds.x).toBe(0);
    expect(bounds.y).toBe(0);

    const tooFar = clampOverlayBounds({ x: 9999, y: 9999, width: 420, height: 600 }, WORK_AREA);
    expect(tooFar.x).toBe(WORK_AREA.width - 420);
    expect(tooFar.y).toBe(WORK_AREA.height - 600);
  });
});

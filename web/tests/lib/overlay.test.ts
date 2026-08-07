import { describe, expect, it } from 'vitest';
import {
  OVERLAY_MAX_HEIGHT,
  OVERLAY_MAX_WIDTH,
  OVERLAY_MIN_HEIGHT,
  OVERLAY_MIN_WIDTH,
  clampOverlaySize,
} from '@/lib/overlay';

describe('clampOverlaySize', () => {
  it('passes a size inside the allowed range through unchanged', () => {
    expect(clampOverlaySize(420, 600)).toEqual({ width: 420, height: 600 });
  });

  it('clamps to the minimum size', () => {
    expect(clampOverlaySize(50, 50)).toEqual({
      width: OVERLAY_MIN_WIDTH,
      height: OVERLAY_MIN_HEIGHT,
    });
  });

  it('clamps to the maximum size', () => {
    expect(clampOverlaySize(5000, 5000)).toEqual({
      width: OVERLAY_MAX_WIDTH,
      height: OVERLAY_MAX_HEIGHT,
    });
  });

  it('rounds fractional sizes', () => {
    expect(clampOverlaySize(420.4, 600.6)).toEqual({ width: 420, height: 601 });
  });
});

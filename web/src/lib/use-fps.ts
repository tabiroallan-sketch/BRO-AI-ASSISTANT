'use client';

import * as React from 'react';

/**
 * Live frames-per-second estimate, derived from the requestAnimationFrame
 * cadence and sampled every `sampleMs`. Because rAF stops when the tab is
 * hidden, this naturally reads ~0 while the stage is not visible.
 */
export function useFps(sampleMs = 1000): number {
  const [fps, setFps] = React.useState(60);

  React.useEffect(() => {
    let frames = 0;
    let last = performance.now();
    let rafId = 0;

    const tick = (): void => {
      frames += 1;
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);

    const sample = (): void => {
      const now = performance.now();
      const elapsed = (now - last) / 1000;
      const current = frames / Math.max(elapsed, 0.001);
      frames = 0;
      last = now;
      setFps(Math.round(current));
    };
    const sampleId = window.setInterval(sample, sampleMs);

    return () => {
      cancelAnimationFrame(rafId);
      window.clearInterval(sampleId);
    };
  }, [sampleMs]);

  return fps;
}

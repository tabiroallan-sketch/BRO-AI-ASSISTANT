'use client';

import * as React from 'react';
import { API_BASE_URL } from '@/lib/api';

export type SystemTelemetry = {
  /** Estimated main-thread load 0..100, derived from requestAnimationFrame cadence. */
  cpu: number;
  /** Used JS heap ratio 0..1, or null in browsers without performance.memory. */
  memory: number | null;
  online: boolean;
  /** API round-trip latency in ms, or null while unreachable. */
  latency: number | null;
  voice: 'off' | 'on' | 'listening';
};

const HEALTH_URL = new URL('/health', API_BASE_URL).toString();

function readMemoryRatio(): number | null {
  const mem = (
    performance as Performance & {
      memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number };
    }
  ).memory;
  if (!mem || mem.jsHeapSizeLimit === 0) {
    return null;
  }
  return Math.min(1, mem.usedJSHeapSize / mem.jsHeapSizeLimit);
}

/**
 * Live client-side telemetry for the HUD status bar.
 * CPU is inferred from the rAF cadence, so animations that keep the main
 * thread busy translate directly into a visible load reading.
 */
export function useSystemStatus(intervalMs = 1000): SystemTelemetry {
  const [telemetry, setTelemetry] = React.useState<SystemTelemetry>({
    cpu: 0,
    memory: null,
    online: typeof navigator !== 'undefined' ? navigator.onLine : true,
    latency: null,
    voice: 'off',
  });

  React.useEffect(() => {
    let disposed = false;
    let frameCount = 0;
    let lastSample = performance.now();
    let rafId = 0;

    const frameLoop = (): void => {
      if (disposed) {
        return;
      }
      frameCount += 1;
      rafId = requestAnimationFrame(frameLoop);
    };
    rafId = requestAnimationFrame(frameLoop);

    const sample = (): void => {
      const now = performance.now();
      const elapsed = (now - lastSample) / 1000;
      const fps = frameCount / Math.max(elapsed, 0.001);
      frameCount = 0;
      lastSample = now;
      const load = Math.min(100, Math.max(0, ((60 - fps) / 60) * 100));
      setTelemetry((t) => ({
        ...t,
        cpu: Math.round(t.cpu * 0.6 + load * 0.4),
        memory: readMemoryRatio(),
      }));
    };
    const sampleId = window.setInterval(sample, intervalMs);

    const ping = async (): Promise<void> => {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 2500);
      const start = performance.now();
      try {
        await fetch(HEALTH_URL, { signal: controller.signal, cache: 'no-store' });
        setTelemetry((t) => ({ ...t, latency: Math.round(performance.now() - start) }));
      } catch {
        setTelemetry((t) => ({ ...t, latency: null }));
      } finally {
        window.clearTimeout(timer);
      }
    };
    void ping();
    const pingId = window.setInterval(() => void ping(), 5000);

    const markOnline = (): void => setTelemetry((t) => ({ ...t, online: true }));
    const markOffline = (): void => setTelemetry((t) => ({ ...t, online: false }));
    window.addEventListener('online', markOnline);
    window.addEventListener('offline', markOffline);

    return () => {
      disposed = true;
      cancelAnimationFrame(rafId);
      window.clearInterval(sampleId);
      window.clearInterval(pingId);
      window.removeEventListener('online', markOnline);
      window.removeEventListener('offline', markOffline);
    };
  }, [intervalMs]);

  return telemetry;
}

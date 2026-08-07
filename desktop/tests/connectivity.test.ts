import { describe, expect, it, vi } from 'vitest';
import { ConnectivityMonitor } from '../src/main/connectivity.js';

describe('ConnectivityMonitor', () => {
  it('reports online when the probe succeeds', async () => {
    const onStatus = vi.fn();
    const monitor = new ConnectivityMonitor({ probe: async () => true, onStatus });
    expect(await monitor.check()).toBe(true);
    expect(monitor.onlineState).toBe(true);
    expect(onStatus).toHaveBeenCalledWith(true);
  });

  it('reports offline when the probe fails or throws', async () => {
    const onStatus = vi.fn();
    const throwing = new ConnectivityMonitor({
      probe: async () => {
        throw new Error('refused');
      },
      onStatus,
    });
    expect(await throwing.check()).toBe(false);
    expect(throwing.onlineState).toBe(false);
  });

  it('start polls on an interval until stopped', async () => {
    vi.useFakeTimers();
    try {
      const probe = vi.fn().mockResolvedValue(true);
      const onStatus = vi.fn();
      const monitor = new ConnectivityMonitor({ probe, intervalMs: 1000, onStatus });
      monitor.start();
      expect(probe).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(2500);
      expect(probe.mock.calls.length).toBeGreaterThanOrEqual(3);
      monitor.stop();
      vi.advanceTimersByTime(5000);
      const calls = probe.mock.calls.length;
      vi.advanceTimersByTime(3000);
      expect(probe.mock.calls.length).toBe(calls);
    } finally {
      vi.useRealTimers();
    }
  });
});

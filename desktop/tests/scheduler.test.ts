import { afterEach, describe, expect, it, vi } from 'vitest';
import { BackgroundScheduler } from '../src/main/services/scheduler.js';

describe('BackgroundScheduler', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs a task repeatedly until stopped', async () => {
    vi.useFakeTimers();
    const run = vi.fn(async () => undefined);
    const scheduler = new BackgroundScheduler();
    scheduler.register({ id: 't', intervalMs: 1000, run });
    scheduler.start();
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3500);
    expect(run.mock.calls.length).toBeGreaterThanOrEqual(4);
    scheduler.stop();
    const calls = run.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(run.mock.calls.length).toBe(calls);
  });

  it('drops cycles while a task is still running (no overlap)', async () => {
    vi.useFakeTimers();
    let release: () => void = () => undefined;
    const run = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = () => resolve();
        }),
    );
    const scheduler = new BackgroundScheduler();
    scheduler.register({ id: 't', intervalMs: 1000, run });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(6000);
    expect(run).toHaveBeenCalledTimes(1);
    release();
    await vi.advanceTimersByTimeAsync(1200);
    expect(run).toHaveBeenCalledTimes(2);
    scheduler.stop();
  });

  it('keeps scheduling after a task throws', async () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    let throwing = true;
    const run = vi.fn(async () => {
      if (throwing) {
        throwing = false;
        throw new Error('boom');
      }
    });
    const scheduler = new BackgroundScheduler({ onError });
    scheduler.register({ id: 't', intervalMs: 1000, run });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(2500);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith('t', expect.any(Error));
    expect(run.mock.calls.length).toBeGreaterThanOrEqual(2);
    scheduler.stop();
  });

  it('evaluates adaptive intervals per cycle', async () => {
    vi.useFakeTimers();
    let mode: 'fast' | 'slow' = 'fast';
    const run = vi.fn(async () => undefined);
    const scheduler = new BackgroundScheduler();
    scheduler.register({ id: 't', intervalMs: () => (mode === 'fast' ? 500 : 2000), run });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(1200);
    expect(run.mock.calls.length).toBeGreaterThanOrEqual(2);
    mode = 'slow';
    const calls = run.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1400);
    expect(run.mock.calls.length).toBe(calls + 1);
    await vi.advanceTimersByTimeAsync(900);
    expect(run.mock.calls.length).toBe(calls + 2);
    scheduler.stop();
  });

  it('unregister stops future runs', async () => {
    vi.useFakeTimers();
    const run = vi.fn(async () => undefined);
    const scheduler = new BackgroundScheduler();
    const unregister = scheduler.register({ id: 't', intervalMs: 1000, run });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(2500);
    const calls = run.mock.calls.length;
    unregister();
    await vi.advanceTimersByTimeAsync(5000);
    expect(run.mock.calls.length).toBe(calls);
    expect(scheduler.has('t')).toBe(false);
  });

  it('tracks size and run counts', async () => {
    vi.useFakeTimers();
    const run = vi.fn(async () => undefined);
    const scheduler = new BackgroundScheduler();
    scheduler.register({ id: 'a', intervalMs: 1000, run });
    scheduler.register({ id: 'b', intervalMs: 1000, run });
    expect(scheduler.size).toBe(2);
    scheduler.start();
    await vi.advanceTimersByTimeAsync(2500);
    expect(scheduler.runCount('a')).toBeGreaterThanOrEqual(2);
    scheduler.stop();
  });
});

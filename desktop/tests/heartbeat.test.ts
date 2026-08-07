import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ServerReport, ServiceId, ServiceState } from '../src/shared/desktop-api.js';
import { Heartbeat } from '../src/main/services/heartbeat.js';

function report(id: ServiceId, state: ServiceState): ServerReport {
  return { id, state };
}

type Options = {
  reports?: () => ServerReport[];
  alive?: (id: ServiceId) => boolean;
  restart?: () => void;
  cooldownMs?: number;
  paused?: boolean;
};

function makeHeartbeat(options: Options = {}) {
  const restarted: ServiceId[] = [];
  const restart = vi.fn(async (id: ServiceId) => {
    restarted.push(id);
    options.restart?.();
  });
  const alive = options.alive ?? (() => true);
  const onTick = vi.fn();
  const onLog = vi.fn();
  const heartbeat = new Heartbeat({
    isBackground: () => false,
    shouldPause: () => options.paused ?? false,
    getReports: options.reports ?? (() => []),
    isServiceAlive: async (id) => alive(id),
    restartService: restart,
    onTick,
    onLog,
    cooldownMs: options.cooldownMs,
  });
  return { heartbeat, restart, alive, onTick, onLog, restarted };
}

describe('Heartbeat', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('restarts a stopped service and reports it', async () => {
    const { heartbeat, restart, onTick, restarted } = makeHeartbeat({
      reports: () => [report('api', 'stopped')],
    });
    const result = await heartbeat.tick();
    expect(restart).toHaveBeenCalledWith('api');
    expect(result.restarted).toEqual(['api']);
    expect(restarted).toEqual(['api']);
    expect(onTick).toHaveBeenCalledWith(result);
  });

  it('restarts a service in an error state', async () => {
    const { heartbeat, restart } = makeHeartbeat({
      reports: () => [report('web', 'error')],
    });
    await heartbeat.tick();
    expect(restart).toHaveBeenCalledWith('web');
  });

  it('does not touch a healthy running service', async () => {
    const { heartbeat, restart } = makeHeartbeat({
      reports: () => [report('api', 'running')],
    });
    const result = await heartbeat.tick();
    expect(restart).not.toHaveBeenCalled();
    expect(result.restarted).toEqual([]);
  });

  it('ignores services that are still starting', async () => {
    const { heartbeat, restart } = makeHeartbeat({
      reports: () => [report('api', 'starting')],
    });
    await heartbeat.tick();
    expect(restart).not.toHaveBeenCalled();
  });

  it('restarts a running service whose liveness probe fails', async () => {
    const { heartbeat, restart } = makeHeartbeat({
      reports: () => [report('postgres', 'running')],
      alive: () => false,
    });
    const result = await heartbeat.tick();
    expect(restart).toHaveBeenCalledWith('postgres');
    expect(result.restarted).toEqual(['postgres']);
  });

  it('does not restart a running service whose liveness probe passes', async () => {
    const { heartbeat, restart } = makeHeartbeat({
      reports: () => [report('postgres', 'running')],
      alive: () => true,
    });
    await heartbeat.tick();
    expect(restart).not.toHaveBeenCalled();
  });

  it('respects the per-service cooldown to prevent restart loops', async () => {
    vi.useFakeTimers();
    const { heartbeat, restart } = makeHeartbeat({
      reports: () => [report('postgres', 'running')],
      alive: () => false,
      cooldownMs: 60_000,
    });
    await heartbeat.tick();
    expect(restart).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000);
    await heartbeat.tick();
    expect(restart).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(40_000);
    await heartbeat.tick();
    expect(restart).toHaveBeenCalledTimes(2);
  });

  it('attempts no recovery while paused', async () => {
    const { heartbeat, restart } = makeHeartbeat({
      paused: true,
      reports: () => [report('api', 'stopped')],
    });
    const result = await heartbeat.tick();
    expect(restart).not.toHaveBeenCalled();
    expect(result.restarted).toEqual([]);
  });

  it('survives a failing restart and reports nothing restarted', async () => {
    const { heartbeat, restart, onLog } = makeHeartbeat({
      reports: () => [report('api', 'stopped')],
      restart: () => {
        throw new Error('failed to start');
      },
    });
    const result = await heartbeat.tick();
    expect(restart).toHaveBeenCalled();
    expect(result.restarted).toEqual([]);
    expect(onLog).toHaveBeenCalledWith(expect.stringContaining('failed to start'));
  });

  it('includes uptime and memory in the report', async () => {
    const { heartbeat } = makeHeartbeat({ reports: () => [report('api', 'running')] });
    const result = await heartbeat.tick();
    expect(result.timestamp).toBeGreaterThan(0);
    expect(result.uptimeMs).toBeGreaterThanOrEqual(0);
    expect(result.memory.heapUsed).toBeGreaterThanOrEqual(0);
    expect(result.memory.rss).toBeGreaterThanOrEqual(0);
  });

  it('throttles to the background interval while the window is hidden', async () => {
    vi.useFakeTimers();
    let hidden = false;
    const onTick = vi.fn();
    const heartbeat = new Heartbeat({
      intervalMs: 1000,
      backgroundIntervalMs: 5000,
      isBackground: () => hidden,
      shouldPause: () => false,
      getReports: () => [],
      isServiceAlive: async () => true,
      restartService: async () => undefined,
      onTick,
    });
    heartbeat.start();
    await vi.advanceTimersByTimeAsync(3500);
    expect(onTick.mock.calls.length).toBeGreaterThanOrEqual(3);
    hidden = true;
    const before = onTick.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1000);
    expect(onTick.mock.calls.length).toBe(before + 1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(onTick.mock.calls.length).toBe(before + 2);
    heartbeat.stop();
  });
});

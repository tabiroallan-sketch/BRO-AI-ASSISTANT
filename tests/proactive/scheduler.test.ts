import { describe, expect, it, vi } from 'vitest';
import { createDedupeStore } from '../../src/proactive/dedupe.js';
import { createScheduler, type SchedulerDependencies } from '../../src/proactive/scheduler.js';

function buildDeps(overrides: Partial<SchedulerDependencies> = {}): SchedulerDependencies {
  const clock = { now: new Date('2026-08-07T10:00:00Z') };
  const created: Array<Record<string, unknown>> = [];
  const deps: SchedulerDependencies = {
    listUsers: async () => [],
    getToken: async () => null,
    createNotification: async (data) => {
      created.push({ ...data });
    },
    dedupe: createDedupeStore(),
    systemProbe: async () => ({ cpuPercent: 10, disks: [] }),
    commandRunner: {
      execFile: async () => ({ code: 0, stdout: '', stderr: '' }),
      shell: async () => ({ code: 0, stdout: '', stderr: '' }),
    },
    portProbe: async () => true,
    httpProbe: async () => ({ ok: true, status: 200 }),
    fetch: async () => ({}),
    now: () => clock.now,
    ...overrides,
  };
  return { deps, created, clock };
}

function enabledSettings(patch: Record<string, unknown> = {}): unknown {
  return { enabled: true, ...patch };
}

const gmailFetch = vi.fn(async (url: string): Promise<unknown> => {
  if (url.includes('/messages?')) {
    return { messages: [{ id: 'msg1' }] };
  }
  if (url.includes('/messages/msg1')) {
    return {
      payload: {
        headers: [
          { name: 'From', value: 'Someone <x@acme.com>' },
          { name: 'Subject', value: 'Re: hello' },
        ],
      },
    };
  }
  return {};
});

describe('proactive scheduler', () => {
  it('skips users with monitoring disabled', async () => {
    const { deps, created } = buildDeps({
      listUsers: async () => [
        { id: 'u1', settings: enabledSettings() },
        { id: 'u2', settings: { enabled: false } },
      ],
    });
    const result = await createScheduler(deps).runSweep();
    expect(result.users).toBe(2);
    expect(result.skipped).toBe(1);
    expect(created).toHaveLength(0);
  });

  it('creates notifications for local alerts and reports the count', async () => {
    const { deps, created } = buildDeps({
      listUsers: async () => [
        {
          id: 'u1',
          settings: enabledSettings({
            sources: {
              lowDisk: true,
              highCpu: true,
              build: false,
              devServer: false,
              http: false,
              email: false,
              calendar: false,
              github: false,
            },
            thresholds: { cpuPercent: 50, diskFreeGb: 5, diskPercent: 90 },
          }),
        },
      ],
      systemProbe: async () => ({
        cpuPercent: 80,
        disks: [{ mount: 'C:', freeGb: 2, sizeGb: 100 }],
      }),
    });
    const result = await createScheduler(deps).runSweep();
    expect(result.notificationsCreated).toBe(2);
    expect(result.suppressed).toBe(0);
    expect(created.map((c) => c.kind).sort()).toEqual(['high_cpu', 'low_disk']);
    expect(created[0]).toMatchObject({ userId: 'u1', priority: 'high' });
  });

  it('does not repeat one-shot notifications across sweeps', async () => {
    const { deps, created } = buildDeps({
      listUsers: async () => [
        { id: 'u1', settings: enabledSettings({ sources: { email: true } }) },
      ],
      getToken: async () => 'token',
      fetch: gmailFetch,
    });
    const scheduler = createScheduler(deps);
    const first = await scheduler.runSweep();
    const second = await scheduler.runSweep();
    expect(first.notificationsCreated).toBe(1);
    expect(second.notificationsCreated).toBe(0);
    expect(created).toHaveLength(1);
    expect((created[0]?.metadata as { dedupeKey?: string })?.dedupeKey).toBe('email:msg1');
  });

  it('re-alerts a failing build after the cooldown window', async () => {
    const { deps, created, clock } = buildDeps({
      listUsers: async () => [
        {
          id: 'u1',
          settings: enabledSettings({
            sources: { build: true },
            cooldownMinutes: 60,
            monitors: [
              { id: 'b1', type: 'build', label: 'Check', command: 'tsc', directory: '/app' },
            ],
          }),
        },
      ],
      commandRunner: {
        execFile: async () => ({ code: 0, stdout: '', stderr: '' }),
        shell: async () => ({ code: 1, stdout: '', stderr: 'err' }),
      },
    });
    const scheduler = createScheduler(deps);
    const first = await scheduler.runSweep();
    const second = await scheduler.runSweep();
    clock.now = new Date('2026-08-07T11:30:00Z');
    const third = await scheduler.runSweep();

    expect(first.notificationsCreated).toBe(1);
    expect(second.notificationsCreated).toBe(0);
    expect(third.notificationsCreated).toBe(1);
    expect(created).toHaveLength(2);
  });

  it('suppresses low/medium alerts during quiet hours but delivers high', async () => {
    const { deps, created } = buildDeps({
      listUsers: async () => [
        {
          id: 'u1',
          settings: enabledSettings({
            sources: { email: true },
            quietHours: {
              enabled: true,
              start: '10:00',
              end: '11:00',
              timezone: 'UTC',
            },
            importantSenders: [],
          }),
        },
      ],
      getToken: async () => 'token',
      fetch: gmailFetch,
    });
    const result = await createScheduler(deps).runSweep();
    expect(result.suppressed).toBe(1);
    expect(result.notificationsCreated).toBe(0);
    expect(created).toHaveLength(0);
  });

  it('lets high-priority alerts through during quiet hours', async () => {
    const { deps, created } = buildDeps({
      listUsers: async () => [
        {
          id: 'u1',
          settings: enabledSettings({
            sources: { email: true },
            quietHours: { enabled: true, start: '10:00', end: '11:00', timezone: 'UTC' },
            importantSenders: ['acme.com'],
          }),
        },
      ],
      getToken: async () => 'token',
      fetch: gmailFetch,
    });
    const result = await createScheduler(deps).runSweep();
    expect(result.suppressed).toBe(0);
    expect(result.notificationsCreated).toBe(1);
    expect(created[0]?.priority).toBe('high');
  });

  it('records a system probe failure but still runs other monitors', async () => {
    const { deps, created } = buildDeps({
      listUsers: async () => [
        {
          id: 'u1',
          settings: enabledSettings({
            sources: { lowDisk: true, highCpu: true, email: true },
          }),
        },
      ],
      getToken: async () => 'token',
      systemProbe: async () => {
        throw new Error('probe exploded');
      },
      fetch: gmailFetch,
    });
    const result = await createScheduler(deps).runSweep();
    expect(result.errors.some((e) => e.source === 'local')).toBe(true);
    expect(result.notificationsCreated).toBe(1);
    expect(created[0]?.kind).toBe('email');
  });

  it('skips email silently when no provider token exists', async () => {
    const { deps, created } = buildDeps({
      listUsers: async () => [
        { id: 'u1', settings: enabledSettings({ sources: { email: true } }) },
      ],
      getToken: async () => null,
      fetch: gmailFetch,
    });
    const result = await createScheduler(deps).runSweep();
    expect(result.notificationsCreated).toBe(0);
    expect(result.errors).toHaveLength(0);
    expect(created).toHaveLength(0);
  });

  it('captures a monitor error per source without losing other users', async () => {
    const { deps } = buildDeps({
      listUsers: async () => [
        { id: 'u1', settings: enabledSettings({ sources: { github: true } }) },
        { id: 'u2', settings: enabledSettings({ sources: { lowDisk: true } }) },
      ],
      getToken: async () => 'token',
      fetch: async () => {
        throw new Error('gh down');
      },
      systemProbe: async () => ({
        cpuPercent: 10,
        disks: [{ mount: '/', freeGb: 50, sizeGb: 100 }],
      }),
    });
    const result = await createScheduler(deps).runSweep();
    expect(result.errors.some((e) => e.source === 'github' && e.userId === 'u1')).toBe(true);
    expect(result.notificationsCreated).toBe(0);
  });
});

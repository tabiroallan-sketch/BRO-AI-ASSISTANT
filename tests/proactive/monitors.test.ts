import { describe, expect, it, vi } from 'vitest';
import { cpuFromLoad, parseDfOutput, parseWindowsDisks } from '../../src/proactive/probes.js';
import {
  checkCalendarMonitors,
  checkEmailMonitors,
  checkEndpointMonitors,
  checkGithubMonitors,
  checkLocalMonitors,
  kindToDedupeMode,
  priorityLabel,
  type EndpointProbeDeps,
  type JsonFetcher,
} from '../../src/proactive/monitors.js';
import { normalizeSettings } from '../../src/proactive/settings.js';
import type { ProactiveSettings } from '../../src/proactive/types.js';

const baseSettings: ProactiveSettings = normalizeSettings({ enabled: true });

function settingsWith(patch: unknown): ProactiveSettings {
  return normalizeSettings({ enabled: true, ...(patch as object) });
}

describe('checkLocalMonitors', () => {
  it('flags a disk below the free-space threshold', () => {
    const drafts = checkLocalMonitors(
      { cpuPercent: 20, disks: [{ mount: 'C:', freeGb: 2, sizeGb: 200 }] },
      baseSettings,
    );
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({ kind: 'low_disk', priority: 'high', dedupeKey: 'disk:C:' });
  });

  it('flags a disk above the usage threshold', () => {
    const drafts = checkLocalMonitors(
      { cpuPercent: 20, disks: [{ mount: '/', freeGb: 10, sizeGb: 100 }] },
      settingsWith({ thresholds: { diskFreeGb: 0.5, diskPercent: 85 } }),
    );
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.kind).toBe('low_disk');
  });

  it('ignores healthy disks', () => {
    const drafts = checkLocalMonitors(
      { cpuPercent: 20, disks: [{ mount: 'C:', freeGb: 200, sizeGb: 500 }] },
      baseSettings,
    );
    expect(drafts).toHaveLength(0);
  });

  it('flags high CPU usage at or above the threshold', () => {
    const drafts = checkLocalMonitors({ cpuPercent: 95, disks: [] }, baseSettings);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({ kind: 'high_cpu', dedupeKey: 'cpu' });
  });

  it('does not flag CPU below the threshold', () => {
    const drafts = checkLocalMonitors({ cpuPercent: 40, disks: [] }, baseSettings);
    expect(drafts).toHaveLength(0);
  });

  it('respects disabled sources', () => {
    const drafts = checkLocalMonitors(
      { cpuPercent: 99, disks: [{ mount: 'C:', freeGb: 1, sizeGb: 100 }] },
      settingsWith({ sources: { lowDisk: false, highCpu: false } }),
    );
    expect(drafts).toHaveLength(0);
  });
});

describe('checkEndpointMonitors', () => {
  function deps(overrides: Partial<EndpointProbeDeps> = {}): EndpointProbeDeps {
    return {
      commandRunner: {
        execFile: vi.fn(async () => ({ code: 0, stdout: '', stderr: '' })),
        shell: vi.fn(async () => ({ code: 0, stdout: '', stderr: '' })),
      },
      portProbe: vi.fn(async () => true),
      httpProbe: vi.fn(async () => ({ ok: true, status: 200 })),
      now: () => new Date('2026-08-07T10:00:00Z'),
      ...overrides,
    };
  }

  it('is quiet when all monitors pass', async () => {
    const settings = settingsWith({
      monitors: [
        { id: 'b1', type: 'build', label: 'Build', command: 'npm run build', directory: '/app' },
        { id: 'd1', type: 'dev_server', label: 'Web', port: 3000 },
        { id: 'h1', type: 'http', label: 'Site', url: 'https://example.com' },
      ],
    });
    const drafts = await checkEndpointMonitors(settings, deps());
    expect(drafts).toHaveLength(0);
  });

  it('alerts when a build check exits non-zero', async () => {
    const settings = settingsWith({
      monitors: [
        { id: 'b1', type: 'build', label: 'Typecheck', command: 'tsc', directory: '/app' },
      ],
    });
    const d = deps({
      commandRunner: {
        execFile: vi.fn(async () => ({ code: 0, stdout: '', stderr: '' })),
        shell: vi.fn(async () => ({ code: 1, stdout: '', stderr: 'error TS2304' })),
      },
    });
    const drafts = await checkEndpointMonitors(settings, d);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({ kind: 'build', priority: 'high', dedupeKey: 'build:b1' });
    expect(drafts[0]?.title).toContain('Typecheck');
    expect(drafts[0]?.body).toContain('code 1');
  });

  it('alerts when a dev server port is closed', async () => {
    const settings = settingsWith({
      monitors: [{ id: 'd1', type: 'dev_server', label: 'Web', port: 3000 }],
    });
    const d = deps({ portProbe: vi.fn(async () => false) });
    const drafts = await checkEndpointMonitors(settings, d);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({ kind: 'dev_server', dedupeKey: 'dev_server:d1' });
    expect(drafts[0]?.body).toContain('3000');
  });

  it('alerts when an HTTP endpoint is unreachable', async () => {
    const settings = settingsWith({
      monitors: [{ id: 'h1', type: 'http', label: 'Site', url: 'https://example.com' }],
    });
    const d = deps({ httpProbe: vi.fn(async () => ({ ok: false, status: 503 })) });
    const drafts = await checkEndpointMonitors(settings, d);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({ kind: 'http', dedupeKey: 'http:h1' });
    expect(drafts[0]?.body).toContain('503');
  });

  it('treats a network failure as a down endpoint', async () => {
    const settings = settingsWith({
      monitors: [{ id: 'h1', type: 'http', label: 'Site', url: 'https://example.com' }],
    });
    const d = deps({ httpProbe: vi.fn(async () => ({ ok: false, status: 0 })) });
    const drafts = await checkEndpointMonitors(settings, d);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.body).toContain('could not be reached');
  });

  it('skips a disabled monitor source', async () => {
    const settings = settingsWith({
      sources: { build: false },
      monitors: [{ id: 'b1', type: 'build', label: 'Build', command: 'tsc', directory: '/app' }],
    });
    const d = deps({
      commandRunner: {
        execFile: vi.fn(async () => ({ code: 0, stdout: '', stderr: '' })),
        shell: vi.fn(async () => ({ code: 1, stdout: '', stderr: 'boom' })),
      },
    });
    const drafts = await checkEndpointMonitors(settings, d);
    expect(drafts).toHaveLength(0);
  });
});

function routeFetch(routes: Record<string, unknown>): JsonFetcher {
  return vi.fn(async (url: string): Promise<unknown> => {
    for (const [needle, body] of Object.entries(routes)) {
      if (url.includes(needle)) {
        return body;
      }
    }
    return {};
  });
}

describe('checkEmailMonitors', () => {
  it('creates a draft per unread message with a stable dedupe key', async () => {
    const fetch = routeFetch({
      '/messages?': { messages: [{ id: 'msg1' }, { id: 'msg2' }] },
      '/messages/msg1': {
        payload: {
          headers: [
            { name: 'From', value: 'Client One <client@acme.com>' },
            { name: 'Subject', value: 'Re: invoice' },
          ],
        },
      },
      '/messages/msg2': { payload: { headers: [{ name: 'From', value: 'noreply@shop.io' }] } },
    });
    const drafts = await checkEmailMonitors('token', baseSettings, fetch);
    expect(drafts).toHaveLength(2);
    expect(drafts.map((d) => d.dedupeKey)).toEqual(['email:msg1', 'email:msg2']);
    expect(drafts[0]?.title).toBe('New email: Re: invoice');
  });

  it('marks messages from important senders as high priority', async () => {
    const fetch = routeFetch({
      '/messages?': { messages: [{ id: 'msg1' }] },
      '/messages/msg1': {
        payload: {
          headers: [{ name: 'From', value: 'Big Client <big@acme.com>' }],
        },
      },
    });
    const settings = settingsWith({ importantSenders: ['acme.com'] });
    const drafts = await checkEmailMonitors('token', settings, fetch);
    expect(drafts[0]?.priority).toBe('high');
    expect(drafts[0]?.title).toBe('Client reply: (no subject)');
  });

  it('sends an authorization header', async () => {
    const fetch = vi.fn(async () => ({ messages: [] }));
    await checkEmailMonitors('sekret', baseSettings, fetch);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('gmail.googleapis.com'),
      expect.objectContaining({ headers: { authorization: 'Bearer sekret' } }),
    );
  });
});

describe('checkCalendarMonitors', () => {
  it('alerts for events within the lead window', async () => {
    const now = new Date('2026-08-07T10:00:00Z');
    const fetch = routeFetch({
      '/events?': {
        items: [
          { id: 'ev1', summary: 'Standup', start: { dateTime: '2026-08-07T10:15:00Z' } },
          { summary: 'No time' },
        ],
      },
    });
    const drafts = await checkCalendarMonitors('token', baseSettings, fetch, now);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      kind: 'calendar',
      priority: 'medium',
      dedupeKey: 'calendar:ev1',
      title: 'Upcoming: Standup',
    });
    expect(drafts[0]?.body).toBe('2026-08-07T10:15:00Z');
  });
});

describe('checkGithubMonitors', () => {
  it('alerts for assigned open issues created recently', async () => {
    const now = new Date('2026-08-07T10:00:00Z');
    const fetch = routeFetch({
      'api.github.com/issues?': [
        { id: 12, number: 101, title: 'Bug', html_url: 'https://github.com/x/y/issues/101' },
        { id: 13, number: 102 },
      ],
    });
    const drafts = await checkGithubMonitors('token', baseSettings, fetch, now);
    expect(drafts).toHaveLength(2);
    expect(drafts[0]).toMatchObject({
      kind: 'github',
      dedupeKey: 'github:12',
      title: 'Issue #101: Bug',
    });
  });

  it('returns nothing when github source is disabled', async () => {
    const fetch = vi.fn(async () => []);
    const drafts = await checkGithubMonitors(
      'token',
      settingsWith({ sources: { github: false } }),
      fetch,
      new Date(),
    );
    expect(drafts).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('helpers', () => {
  it('maps kinds to their dedupe mode', () => {
    expect(kindToDedupeMode('email')).toBe('once');
    expect(kindToDedupeMode('calendar')).toBe('once');
    expect(kindToDedupeMode('github')).toBe('once');
    expect(kindToDedupeMode('build')).toBe('cooldown');
    expect(kindToDedupeMode('low_disk')).toBe('cooldown');
    expect(kindToDedupeMode('dev_server')).toBe('cooldown');
  });

  it('labels priorities', () => {
    expect(priorityLabel('critical')).toBe('Critical');
    expect(priorityLabel('low')).toBe('Low');
  });
});

describe('system sample parsers', () => {
  it('parses df -P output', () => {
    const output = [
      'Filesystem 1024-blocks Used Available Capacity Mounted on',
      '/dev/sda1  104857600 52428800 52428800 50% /',
      '/dev/sdb1  10485760  1048576  9437184  10% /data',
    ].join('\n');
    const disks = parseDfOutput(output);
    expect(disks).toHaveLength(2);
    expect(disks[0]).toEqual({ mount: '/', freeGb: 50, sizeGb: 100 });
    expect(disks[1]?.freeGb).toBeCloseTo(9);
  });

  it('parses Windows disk JSON', () => {
    const output = JSON.stringify([
      { DeviceID: 'C:', FreeGB: 42.5, SizeGB: 500 },
      { DeviceID: 'D:', FreeGB: 2, SizeGB: 200 },
    ]);
    const disks = parseWindowsDisks(output);
    expect(disks).toHaveLength(2);
    expect(disks[0]).toEqual({ mount: 'C:', freeGb: 42.5, sizeGb: 500 });
  });

  it('tolerates malformed Windows disk output', () => {
    expect(parseWindowsDisks('not json')).toEqual([]);
    expect(parseWindowsDisks('')).toEqual([]);
  });

  it('derives CPU percentage from load average', () => {
    expect(cpuFromLoad(4, 8)).toBe(50);
    expect(cpuFromLoad(8, 8)).toBe(100);
    expect(cpuFromLoad(20, 8)).toBe(100);
    expect(cpuFromLoad(-1, 8)).toBe(0);
  });
});

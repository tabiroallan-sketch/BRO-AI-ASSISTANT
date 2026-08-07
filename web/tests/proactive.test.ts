vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = 'http://test.local/api/v1';
});

const store = new Map<string, string>();

globalThis.localStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => {
    store.set(key, value);
  },
  removeItem: (key: string) => {
    store.delete(key);
  },
} as unknown as Storage;

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getProactiveSettings,
  getProactiveStatus,
  isMonitorType,
  monitorSummary,
  monitorTypeLabel,
  runProactiveSweep,
  updateProactiveSettings,
  type ProactiveSettings,
  type ProactiveStatus,
} from '@/lib/proactive';
import { setTokens } from '@/lib/token-store';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function settings(overrides: Partial<ProactiveSettings> = {}): ProactiveSettings {
  return {
    enabled: true,
    sources: {
      build: true,
      devServer: true,
      http: true,
      lowDisk: true,
      highCpu: true,
      email: true,
      calendar: true,
      github: true,
    },
    monitors: [],
    thresholds: { cpuPercent: 90, diskFreeGb: 5, diskPercent: 90 },
    quietHours: {
      enabled: false,
      start: '22:00',
      end: '07:00',
      timezone: null,
    },
    cooldownMinutes: 120,
    calendarLeadMinutes: 30,
    importantSenders: [],
    ...overrides,
  };
}

function status(overrides: Partial<ProactiveStatus> = {}): ProactiveStatus {
  return {
    running: false,
    intervalMs: 300000,
    lastSweep: null,
    lastSweepError: null,
    ...overrides,
  };
}

describe('proactive client', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    setTokens('access-token', 'refresh-token');
  });

  it('fetches settings', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ settings: settings() }));

    const result = await getProactiveSettings();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://test.local/api/v1/proactive/settings');
    expect(init.headers).toMatchObject({ authorization: 'Bearer access-token' });
    expect(result.enabled).toBe(true);
    expect(result.thresholds.cpuPercent).toBe(90);
  });

  it('updates settings via PUT with the settings body', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ settings: settings({ enabled: false }) }));

    const result = await updateProactiveSettings(settings({ enabled: false }));

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://test.local/api/v1/proactive/settings');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toEqual({
      settings: settings({ enabled: false }),
    });
    expect(result.enabled).toBe(false);
  });

  it('runs a proactive sweep via POST', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        checkedAt: '2026-08-07T00:00:00.000Z',
        users: 2,
        notificationsCreated: 3,
        suppressed: 1,
        skipped: 0,
        errors: [],
      }),
    );

    const result = await runProactiveSweep();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://test.local/api/v1/proactive/run');
    expect(init.method).toBe('POST');
    expect(result.notificationsCreated).toBe(3);
  });

  it('fetches monitor status', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ...status({ intervalMs: 60000 }) }));

    const result = await getProactiveStatus();

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://test.local/api/v1/proactive/status');
    expect(result.intervalMs).toBe(60000);
  });
});

describe('monitor helpers', () => {
  it('validates monitor types', () => {
    expect(isMonitorType('build')).toBe(true);
    expect(isMonitorType('dev_server')).toBe(true);
    expect(isMonitorType('http')).toBe(true);
    expect(isMonitorType('cron')).toBe(false);
  });

  it('labels monitor types', () => {
    expect(monitorTypeLabel('build')).toBe('Build command');
    expect(monitorTypeLabel('dev_server')).toBe('Dev server port');
    expect(monitorTypeLabel('http')).toBe('HTTP endpoint');
  });

  it('summarizes monitors', () => {
    expect(
      monitorSummary({
        id: '1',
        type: 'build',
        label: 'Build',
        directory: 'C:\\repo',
        command: 'npm run build',
      }),
    ).toBe('npm run build (C:\\repo)');
    expect(monitorSummary({ id: '2', type: 'dev_server', label: 'Web', port: 3000 })).toBe(
      'localhost:3000',
    );
    expect(
      monitorSummary({ id: '3', type: 'http', label: 'Health', url: 'https://example.com' }),
    ).toBe('https://example.com');
  });
});

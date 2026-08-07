import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

process.env.DATABASE_URL = '';
process.env.REDIS_URL = '';
process.env.JWT_SECRET = 'proactive-test-access-secret';
process.env.JWT_REFRESH_SECRET = 'proactive-test-refresh-secret';
process.env.JWT_EXPIRES_IN = '15m';
process.env.JWT_REFRESH_EXPIRES_IN = '7d';

const { mockRunSweep, mockGetStatus, mockStart, mockStop } = vi.hoisted(() => ({
  mockRunSweep: vi.fn(async () => ({
    checkedAt: new Date('2026-08-07T10:00:00Z'),
    users: 1,
    notificationsCreated: 2,
    suppressed: 0,
    skipped: 0,
    errors: [],
  })),
  mockGetStatus: vi.fn(() => ({
    running: false,
    intervalMs: 300000,
    lastSweep: null,
    lastSweepError: null,
  })),
  mockStart: vi.fn(),
  mockStop: vi.fn(),
}));

vi.mock('../src/proactive/index.js', () => ({
  runProactiveSweep: mockRunSweep,
  getProactiveStatus: mockGetStatus,
  startProactiveMonitor: mockStart,
  stopProactiveMonitor: mockStop,
}));

vi.mock('../src/lib/prisma.js', async () => {
  const { getMockDb } = await import('./helpers/mock-db.js');
  return { prisma: getMockDb().mockPrisma };
});

describe('proactive routes', () => {
  let app: FastifyInstance;
  let db: import('./helpers/mock-db.js').MockDb;

  beforeAll(async () => {
    const [{ buildApp }, mockDb] = await Promise.all([
      import('../src/app.js'),
      import('./helpers/mock-db.js'),
    ]);
    db = mockDb.getMockDb();
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    db.resetDb();
  });

  async function authSession(email: string): Promise<{ authorization: string }> {
    const token = await db.registerAndLogin(email);
    return { authorization: `Bearer ${token}` };
  }

  it('returns default settings for a new user', async () => {
    const { authorization } = await authSession('owner@example.com');
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/proactive/settings',
      headers: { authorization },
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.settings.enabled).toBe(false);
    expect(body.settings.sources.email).toBe(true);
    expect(body.settings.cooldownMinutes).toBe(120);
    expect(body.settings.thresholds).toEqual({ cpuPercent: 90, diskFreeGb: 5, diskPercent: 90 });
  });

  it('persists settings via PUT and returns them on GET', async () => {
    const { authorization } = await authSession('owner@example.com');
    const put = await app.inject({
      method: 'PUT',
      url: '/api/v1/proactive/settings',
      headers: { authorization },
      payload: { enabled: true, cooldownMinutes: 45, importantSenders: ['acme.com'] },
    });
    expect(put.statusCode).toBe(200);
    expect(JSON.parse(put.body).settings.enabled).toBe(true);
    expect(JSON.parse(put.body).settings.cooldownMinutes).toBe(45);

    const get = await app.inject({
      method: 'GET',
      url: '/api/v1/proactive/settings',
      headers: { authorization },
    });
    const body = JSON.parse(get.body);
    expect(body.settings.enabled).toBe(true);
    expect(body.settings.cooldownMinutes).toBe(45);
    expect(body.settings.importantSenders).toEqual(['acme.com']);
    expect(body.settings.sources.email).toBe(true);
  });

  it('accepts a full settings payload under a "settings" key', async () => {
    const { authorization } = await authSession('owner@example.com');
    const put = await app.inject({
      method: 'PUT',
      url: '/api/v1/proactive/settings',
      headers: { authorization },
      payload: {
        settings: { enabled: true, sources: { email: false, github: false } },
      },
    });
    const body = JSON.parse(put.body);
    expect(body.settings.enabled).toBe(true);
    expect(body.settings.sources.email).toBe(false);
    expect(body.settings.sources.calendar).toBe(true);
  });

  it('clamps out-of-range values on PUT', async () => {
    const { authorization } = await authSession('owner@example.com');
    const put = await app.inject({
      method: 'PUT',
      url: '/api/v1/proactive/settings',
      headers: { authorization },
      payload: { enabled: true, cooldownMinutes: 0, thresholds: { cpuPercent: 999 } },
    });
    const body = JSON.parse(put.body);
    expect(body.settings.cooldownMinutes).toBe(5);
    expect(body.settings.thresholds.cpuPercent).toBe(100);
  });

  it('runs a sweep via POST /run', async () => {
    const { authorization } = await authSession('owner@example.com');
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/proactive/run',
      headers: { authorization },
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).notificationsCreated).toBe(2);
    expect(mockRunSweep).toHaveBeenCalled();
  });

  it('returns proactive status', async () => {
    const { authorization } = await authSession('owner@example.com');
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/proactive/status',
      headers: { authorization },
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toMatchObject({ running: false, intervalMs: 300000 });
  });

  it('requires authentication on every endpoint', async () => {
    const cases: Array<{ method: string; url: string }> = [
      { method: 'GET', url: '/api/v1/proactive/settings' },
      { method: 'PUT', url: '/api/v1/proactive/settings' },
      { method: 'POST', url: '/api/v1/proactive/run' },
      { method: 'GET', url: '/api/v1/proactive/status' },
    ];
    for (const testCase of cases) {
      const response = await app.inject({ method: testCase.method as 'GET', url: testCase.url });
      expect(response.statusCode).toBe(401);
    }
  });
});

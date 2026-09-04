import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { clearAuditLogs } from '../../src/lib/audit.js';

process.env.DATABASE_URL = '';
process.env.REDIS_URL = '';
process.env.JWT_SECRET = 'test-access-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
process.env.JWT_EXPIRES_IN = '15m';
process.env.JWT_REFRESH_EXPIRES_IN = '7d';

type MockUser = {
  id: string;
  email: string;
  passwordHash: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  role: 'USER' | 'ADMIN';
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

type MockSession = {
  id: string;
  userId: string;
  token: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

type Row = Record<string, unknown> & { id: string };

const { mockPrisma, resetDb, registerAndLogin } = vi.hoisted(() => {
  const users = new Map<string, MockUser>();
  const sessions = new Map<string, MockSession>();
  const discoveredLeads = new Map<string, Row>();
  const leadSearches = new Map<string, Row>();
  const notifications = new Map<string, Row>();

  const userModel = {
    async findUnique(args: { where: { id?: string; email?: string } }): Promise<MockUser | null> {
      if (args.where.id !== undefined) {
        return users.get(args.where.id) ?? null;
      }
      if (args.where.email !== undefined) {
        for (const user of users.values()) {
          if (user.email === args.where.email) {
            return user;
          }
        }
      }
      return null;
    },
    async create(args: {
      data: { email: string; passwordHash: string | null; displayName?: string | null };
    }): Promise<MockUser> {
      const now = new Date();
      const user: MockUser = {
        id: randomUUID(),
        email: args.data.email,
        passwordHash: args.data.passwordHash,
        displayName: args.data.displayName ?? null,
        avatarUrl: null,
        role: 'USER',
        isActive: true,
        createdAt: now,
        updatedAt: now,
      };
      users.set(user.id, user);
      return user;
    },
  };

  const sessionModel = {
    async create(args: {
      data: { userId: string; token: string; expiresAt: Date };
    }): Promise<MockSession> {
      const now = new Date();
      const session: MockSession = {
        id: randomUUID(),
        userId: args.data.userId,
        token: args.data.token,
        expiresAt: args.data.expiresAt,
        createdAt: now,
        updatedAt: now,
      };
      sessions.set(session.id, session);
      return session;
    },
    async findFirst(args: {
      where: { token: string };
      include?: { user: { select?: unknown } };
    }): Promise<(MockSession & { user: MockUser }) | null> {
      for (const session of sessions.values()) {
        if (session.token === args.where.token) {
          const user = users.get(session.userId);
          if (user) {
            return { ...session, user };
          }
        }
      }
      return null;
    },
    async delete(args: { where: { id: string } }): Promise<MockSession> {
      const session = sessions.get(args.where.id);
      if (session) {
        sessions.delete(args.where.id);
      }
      return session ?? ({} as MockSession);
    },
  };

  function matches(row: Row, where: Record<string, unknown>): boolean {
    for (const [key, expected] of Object.entries(where)) {
      const actual = row[key];
      if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
        const spec = expected as Record<string, unknown>;
        if ('gte' in spec) {
          if (typeof actual === 'number' && typeof spec.gte === 'number' && actual < spec.gte) {
            return false;
          }
        }
        if ('lte' in spec) {
          if (typeof actual === 'number' && typeof spec.lte === 'number' && actual > spec.lte) {
            return false;
          }
        }
      } else if (actual === undefined && expected === null) {
        // undefined (unset optional column) behaves like SQL NULL
        continue;
      } else if (actual !== expected) {
        return false;
      }
    }
    return true;
  }

  function genericModel(store: Map<string, Row>) {
    return {
      async findMany(args: {
        where?: Record<string, unknown>;
        orderBy?: unknown;
        take?: number;
      }): Promise<Row[]> {
        let list = [...store.values()].filter((row) => matches(row, args.where ?? {}));
        if (args.orderBy && typeof args.orderBy === 'object' && !Array.isArray(args.orderBy)) {
          const entries = Object.entries(args.orderBy as Record<string, string>);
          for (const [field, direction] of entries) {
            list = list.sort((a, b) => {
              const av = a[field];
              const bv = b[field];
              if (typeof av === 'number' && typeof bv === 'number') {
                return direction === 'asc' ? av - bv : bv - av;
              }
              return direction === 'asc'
                ? String(av ?? '').localeCompare(String(bv ?? ''))
                : String(bv ?? '').localeCompare(String(av ?? ''));
            });
          }
        }
        if (args.take !== undefined) {
          list = list.slice(0, args.take);
        }
        return list;
      },
      async findFirst(args: { where: Record<string, unknown> }): Promise<Row | null> {
        return [...store.values()].find((row) => matches(row, args.where)) ?? null;
      },
      async count(args: { where: Record<string, unknown> }): Promise<number> {
        return [...store.values()].filter((row) => matches(row, args.where)).length;
      },
      async create(args: { data: Record<string, unknown> }): Promise<Row> {
        const row: Row = {
          id: randomUUID(),
          createdAt: new Date(),
          updatedAt: new Date(),
          ...args.data,
        };
        store.set(row.id, row);
        return row;
      },
      async update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<Row> {
        const row = store.get(args.where.id);
        if (!row) {
          throw new Error('Not found');
        }
        const updated = { ...row, ...args.data, updatedAt: new Date() };
        store.set(updated.id, updated);
        return updated;
      },
      async delete(args: { where: { id: string } }): Promise<Row> {
        const row = store.get(args.where.id);
        if (row) {
          store.delete(args.where.id);
        }
        return row ?? ({} as Row);
      },
      async deleteMany(args: { where: Record<string, unknown> }): Promise<{ count: number }> {
        const targets = [...store.values()].filter((row) => matches(row, args.where));
        for (const target of targets) {
          store.delete(target.id);
        }
        return { count: targets.length };
      },
    };
  }

  async function registerAndLogin(email: string): Promise<string> {
    const now = new Date();
    const user: MockUser = {
      id: randomUUID(),
      email,
      passwordHash: 'hash',
      displayName: null,
      avatarUrl: null,
      role: 'USER',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };
    users.set(user.id, user);
    sessions.set(randomUUID(), {
      id: randomUUID(),
      userId: user.id,
      token: `token-${user.id}`,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      createdAt: now,
      updatedAt: now,
    });

    const { signAccessToken } = await import('../../src/lib/jwt.js');
    return signAccessToken(user.id, user.role);
  }

  return {
    mockPrisma: {
      user: userModel,
      session: sessionModel,
      discoveredLead: genericModel(discoveredLeads),
      leadSearch: genericModel(leadSearches),
      notification: genericModel(notifications),
      $disconnect: async (): Promise<void> => undefined,
    },
    resetDb: (): void => {
      users.clear();
      sessions.clear();
      discoveredLeads.clear();
      leadSearches.clear();
      notifications.clear();
    },
    registerAndLogin,
  };
});

vi.mock('../../src/lib/prisma.js', () => ({ prisma: mockPrisma }));

vi.mock('../../src/lead-finder/orchestrator.js', () => ({
  searchProviders: vi.fn(async () => [
    { providerId: 'google_maps', leads: [], error: undefined, latencyMs: 1 },
  ]),
  combineResults: vi.fn(() => []),
  getProviderStatuses: vi.fn(() => [
    { id: 'google_maps', label: 'Google Maps', configured: true, apiKeyRequired: true },
    { id: 'web', label: 'Web', configured: false, apiKeyRequired: true },
  ]),
}));

vi.mock('../../src/lead-finder/enrichment.js', () => ({
  enrichLead: vi.fn(async (lead: unknown) => ({
    summary: `Researched ${(lead as { companyName?: string }).companyName ?? 'lead'}`,
    painPoints: [{ text: 'No explicit pain points', confidence: 'Unknown' }],
    automationOpportunities: [{ text: 'AI receptionist', confidence: 'Inferred' }],
    recommendation: 'Follow up',
    recommendedApproach: 'Research their site',
    score: {
      total: 70,
      signals: 10,
      relevance: 10,
      decisionPower: 10,
      budget: 10,
      technical: 10,
      reasons: ['ok'],
    },
  })),
  scoreLead: vi.fn((lead: unknown) => ({
    total: (lead as { rating?: number }).rating ? 80 : 50,
    signals: 10,
    relevance: 10,
    decisionPower: 10,
    budget: 10,
    technical: 10,
    reasons: ['test'],
  })),
}));

vi.mock('../../src/lead-finder/query-parser.js', () => ({
  parseSearchQuery: vi.fn(async (query: string) => ({
    query,
    sources: ['google_maps'],
    limit: 25,
  })),
}));

vi.mock('../../src/lead-finder/outreach.js', () => ({
  generateOutreach: vi.fn(async (lead: unknown, channel: string) => ({
    channel,
    subject: `Hi ${(lead as { companyName?: string }).companyName ?? ''}`,
    body: 'Hello, this is your outreach message.',
  })),
  generateMultiChannelOutreach: vi.fn(async (lead: unknown, channels: string[]) =>
    channels.map((channel) => ({
      channel,
      subject: `Hi`,
      body: 'Multi-channel outreach.',
    })),
  ),
}));

describe('lead finder API', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { buildApp } = await import('../../src/app.js');
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    resetDb();
    clearAuditLogs();
  });

  async function authHeaders(email: string): Promise<{ authorization: string }> {
    const token = await registerAndLogin(email);
    return { authorization: `Bearer ${token}` };
  }

  it('requires authentication on lead-finder endpoints', async () => {
    const get = await app.inject({ method: 'GET', url: '/api/v1/lead-finder/providers' });
    expect(get.statusCode).toBe(401);
    const post = await app.inject({ method: 'POST', url: '/api/v1/lead-finder/search' });
    expect(post.statusCode).toBe(401);
    const list = await app.inject({ method: 'GET', url: '/api/v1/lead-finder/leads' });
    expect(list.statusCode).toBe(401);
  });

  it('lists provider statuses', async () => {
    const headers = await authHeaders('providers@example.com');
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/lead-finder/providers',
      headers,
    });
    expect(response.statusCode).toBe(200);
    const { providers } = JSON.parse(response.body);
    expect(providers.length).toBeGreaterThanOrEqual(5);
    const ids = providers.map((provider: { id: string }) => provider.id);
    expect(ids).toContain('google_maps');
    expect(ids).toContain('linkedin');
    expect(ids).toContain('indeed');
    expect(ids).toContain('reddit');
    expect(ids).toContain('web');
  });

  it('runs a search and returns zero leads when providers find nothing', async () => {
    const headers = await authHeaders('search@example.com');
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/lead-finder/search',
      headers,
      payload: { query: 'dental clinics', parseNatural: false },
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.total).toBe(0);
    expect(body.leads).toEqual([]);
  });

  it('saves a lead, lists it, and records a notification', async () => {
    const headers = await authHeaders('save@example.com');
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/lead-finder/leads',
      headers,
      payload: {
        companyName: 'Acme Dental',
        city: 'Austin',
        state: 'TX',
        country: 'US',
        source: 'google_maps',
        leadScore: 90,
      },
    });
    expect(create.statusCode).toBe(201);
    const { lead } = JSON.parse(create.body);
    expect(lead.companyName).toBe('Acme Dental');
    expect(lead.leadScore).toBe(90);

    const list = await app.inject({ method: 'GET', url: '/api/v1/lead-finder/leads', headers });
    expect(list.statusCode).toBe(200);
    const { leads } = JSON.parse(list.body);
    expect(leads).toHaveLength(1);
    expect(leads[0].companyName).toBe('Acme Dental');

    const unread = await app.inject({
      method: 'GET',
      url: '/api/v1/notifications?unread=true',
      headers,
    });
    expect(unread.statusCode).toBe(200);
    const { notifications } = JSON.parse(unread.body);
    expect(
      notifications.some((notification: { title?: string }) =>
        notification.title?.includes('Lead'),
      ),
    ).toBe(true);
  });

  it('enriches a saved lead and persists enrichment data', async () => {
    const headers = await authHeaders('enrich@example.com');
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/lead-finder/leads',
      headers,
      payload: { companyName: 'Bright Smiles', source: 'google_maps' },
    });
    const { lead } = JSON.parse(create.body);

    const enrich = await app.inject({
      method: 'POST',
      url: `/api/v1/lead-finder/leads/${lead.id}/enrich`,
      headers,
    });
    expect(enrich.statusCode).toBe(200);
    const body = JSON.parse(enrich.body);
    expect(body.enrichment.summary).toContain('Bright Smiles');
    expect(body.enrichment.painPoints.length).toBeGreaterThan(0);
  });

  it('generates outreach for a saved lead', async () => {
    const headers = await authHeaders('outreach@example.com');
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/lead-finder/leads',
      headers,
      payload: { companyName: 'Sunny Auto', source: 'web' },
    });
    const { lead } = JSON.parse(create.body);

    const outreach = await app.inject({
      method: 'POST',
      url: `/api/v1/lead-finder/leads/${lead.id}/outreach`,
      headers,
      payload: { channel: 'cold_email', tone: 'professional' },
    });
    expect(outreach.statusCode).toBe(200);
    const body = JSON.parse(outreach.body);
    expect(body.outreach).toHaveLength(1);
    expect(body.outreach[0].channel).toBe('cold_email');
    expect(body.outreach[0].subject).toContain('Sunny Auto');
  });

  it('returns 404 when enriching a non-existent lead', async () => {
    const headers = await authHeaders('missing@example.com');
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/lead-finder/leads/nope/enrich',
      headers,
    });
    expect(response.statusCode).toBe(404);
  });

  it('updates and deletes a saved lead', async () => {
    const headers = await authHeaders('mutate@example.com');
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/lead-finder/leads',
      headers,
      payload: { companyName: 'Delta Co', source: 'linkedin', leadScore: 40 },
    });
    const { lead } = JSON.parse(create.body);

    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/v1/lead-finder/leads/${lead.id}`,
      headers,
      payload: { status: 'QUALIFIED', notes: 'met at conference' },
    });
    expect(patch.statusCode).toBe(200);
    expect(JSON.parse(patch.body).lead.status).toBe('QUALIFIED');
    expect(JSON.parse(patch.body).lead.notes).toBe('met at conference');

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/lead-finder/leads/${lead.id}`,
      headers,
    });
    expect(del.statusCode).toBe(204);

    const list = await app.inject({ method: 'GET', url: '/api/v1/lead-finder/leads', headers });
    expect(JSON.parse(list.body).leads).toHaveLength(0);
  });
});

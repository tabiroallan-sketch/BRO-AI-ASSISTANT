import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { clearAuditLogs, getAuditLogs } from '../src/lib/audit.js';

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
  const services = new Map<string, Row>();
  const opportunities = new Map<string, Row>();
  const leads = new Map<string, Row>();
  const research = new Map<string, Row>();
  const drafts = new Map<string, Row>();
  const offers = new Map<string, Row>();
  const memories = new Map<string, Row>();
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
      if (key === 'OR') {
        const groups = expected as Record<string, unknown>[];
        if (!groups.some((group) => matches(row, group))) {
          return false;
        }
        continue;
      }
      const actual = row[key];
      if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
        const spec = expected as Record<string, unknown>;
        if ('notIn' in spec) {
          const list = spec.notIn as unknown[];
          if (list.includes(actual)) {
            return false;
          }
        }
        if ('lte' in spec) {
          if (typeof actual === 'number' && typeof spec.lte === 'number') {
            if (actual > spec.lte) {
              return false;
            }
          } else if (actual instanceof Date && spec.lte instanceof Date) {
            if (actual.getTime() > spec.lte.getTime()) {
              return false;
            }
          } else if (actual !== undefined && actual !== null) {
            const actualTime =
              typeof actual === 'number' ? actual : new Date(actual as string).getTime();
            const lteTime =
              typeof spec.lte === 'number' ? spec.lte : new Date(spec.lte as string).getTime();
            if (actualTime > lteTime) {
              return false;
            }
          }
        }
        if ('gte' in spec) {
          if (typeof actual === 'number' && typeof spec.gte === 'number') {
            if (actual < spec.gte) {
              return false;
            }
          } else if (actual instanceof Date && spec.gte instanceof Date) {
            if (actual.getTime() < spec.gte.getTime()) {
              return false;
            }
          }
        }
        if ('contains' in spec) {
          const haystack = String(actual ?? '').toLowerCase();
          if (!haystack.includes(String(spec.contains).toLowerCase())) {
            return false;
          }
        }
        if ('equals' in spec && actual !== spec.equals) {
          return false;
        }
        continue;
      }
      if (actual !== expected) {
        return false;
      }
    }
    return true;
  }

  function genericModel(store: Map<string, Row>): {
    findMany(args: {
      where?: Record<string, unknown>;
      orderBy?: unknown;
      take?: number;
      select?: Record<string, unknown>;
    }): Promise<Row[]>;
    findFirst(args: { where: Record<string, unknown> }): Promise<Row | null>;
    count(args: { where: Record<string, unknown> }): Promise<number>;
    create(args: { data: Record<string, unknown> }): Promise<Row>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<Row>;
    deleteMany(args: { where: Record<string, unknown> }): Promise<{ count: number }>;
  } {
    return {
      async findMany(args: {
        where?: Record<string, unknown>;
        orderBy?: unknown;
        take?: number;
        select?: Record<string, unknown>;
      }): Promise<Row[]> {
        let list = [...store.values()].filter((row) => matches(row, args.where ?? {}));
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
      async deleteMany(args: { where: Record<string, unknown> }): Promise<{ count: number }> {
        const targets = [...store.values()].filter((row) => matches(row, args.where));
        for (const target of targets) {
          store.delete(target.id);
        }
        return { count: targets.length };
      },
    };
  }

  const serviceModel = {
    ...genericModel(services),
    async createMany(args: { data: Record<string, unknown>[] }): Promise<{ count: number }> {
      const now = new Date();
      for (const data of args.data) {
        const row: Row = {
          id: randomUUID(),
          createdAt: now,
          updatedAt: now,
          ...data,
        };
        services.set(row.id, row);
      }
      return { count: args.data.length };
    },
  };

  const draftModel = {
    ...genericModel(drafts),
    async create(args: { data: Record<string, unknown> }): Promise<Row> {
      return genericModel(drafts).create({
        data: {
          status: 'DRAFT',
          kind: 'COLD_EMAIL',
          channel: 'email',
          ...args.data,
        },
      });
    },
  };

  const aiConfigModel = {
    async findUnique(): Promise<null> {
      return null;
    },
    async upsert(args: { create: Partial<Row> }): Promise<Row> {
      return { id: 'default', ...args.create } as Row;
    },
  };

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

    const { signAccessToken } = await import('../src/lib/jwt.js');
    return signAccessToken(user.id, user.role);
  }

  return {
    mockPrisma: {
      user: userModel,
      session: sessionModel,
      service: serviceModel,
      opportunity: genericModel(opportunities),
      lead: genericModel(leads),
      companyResearch: genericModel(research),
      salesDraft: draftModel,
      offer: genericModel(offers),
      memory: genericModel(memories),
      aiConfig: aiConfigModel,
      $disconnect: async (): Promise<void> => undefined,
    },
    resetDb: (): void => {
      users.clear();
      sessions.clear();
      services.clear();
      opportunities.clear();
      leads.clear();
      research.clear();
      drafts.clear();
      offers.clear();
      memories.clear();
    },
    registerAndLogin,
  };
});

vi.mock('../src/lib/prisma.js', () => ({ prisma: mockPrisma }));

vi.mock('../src/sales/llm.js', () => ({
  isAiConfigured: (): boolean => false,
  salesCompletion: vi.fn(async (): Promise<never> => {
    throw new Error('AI disabled in tests');
  }),
  parseStructuredJson: vi.fn((): null => null),
}));

describe('sales engine', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { buildApp } = await import('../src/app.js');
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

  it('requires authentication on every sales endpoint', async () => {
    const get = await app.inject({ method: 'GET', url: '/api/v1/sales/overview' });
    expect(get.statusCode).toBe(401);
    const post = await app.inject({ method: 'POST', url: '/api/v1/sales/leads' });
    expect(post.statusCode).toBe(401);
  });

  it('seeds the default service catalog on first read', async () => {
    const headers = await authHeaders('catalog@example.com');
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/sales/services',
      headers,
    });
    expect(response.statusCode).toBe(200);
    const { services: list } = JSON.parse(response.body);
    expect(list.length).toBeGreaterThan(5);
    expect(list[0].name).toBe('Website development');
    expect(list[0].minimumPrice).toBe(1500);
  });

  it('creates an opportunity and scores it automatically', async () => {
    const headers = await authHeaders('opportunity@example.com');
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/sales/opportunities',
      headers,
      payload: {
        title: 'Landing page for a local bakery',
        type: 'POTENTIAL_CLIENT',
        estimatedBudget: 4000,
        requiredSkills: ['react', 'nextjs'],
      },
    });
    expect(create.statusCode).toBe(201);
    const body = JSON.parse(create.body);
    expect(body.opportunity.status).toBe('NEW');
    expect(body.opportunity.score).toBeGreaterThanOrEqual(0);
    expect(body.score.score).toBe(body.opportunity.score);

    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/sales/opportunities',
      headers,
    });
    const { opportunities } = JSON.parse(list.body);
    expect(opportunities).toHaveLength(1);
    expect(opportunities[0].estimatedBudget).toBe(4000);

    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/v1/sales/opportunities/${body.opportunity.id}`,
      headers,
      payload: { status: 'EVALUATING' },
    });
    expect(patch.statusCode).toBe(200);
    expect(JSON.parse(patch.body).opportunity.status).toBe('EVALUATING');
  });

  it('re-scores an existing opportunity on demand', async () => {
    const headers = await authHeaders('rescore@example.com');
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/sales/opportunities',
      headers,
      payload: { title: 'A job', type: 'JOB', estimatedBudget: 1000 },
    });
    const { opportunity } = JSON.parse(create.body);

    const scored = await app.inject({
      method: 'POST',
      url: `/api/v1/sales/opportunities/${opportunity.id}/score`,
      headers,
    });
    expect(scored.statusCode).toBe(200);
    expect(JSON.parse(scored.body).score.score).toBeGreaterThanOrEqual(0);
  });

  it('lists the available discovery sources', async () => {
    const headers = await authHeaders('sources@example.com');
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/sales/discover/sources',
      headers,
    });
    expect(response.statusCode).toBe(200);
    const { sources } = JSON.parse(response.body);
    expect(sources.map((source: { id: string }) => source.id)).toEqual(
      expect.arrayContaining(['user-submitted', 'web-search', 'company-career']),
    );
  });

  it('requires a query, url, or companyWebsite for discovery', async () => {
    const headers = await authHeaders('discover@example.com');
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/sales/discover',
      headers,
      payload: { sources: ['user-submitted'] },
    });
    expect(response.statusCode).toBe(400);
  });

  it('submits a user-provided opportunity and saves it as a high-reliability candidate', async () => {
    const headers = await authHeaders('submit@example.com');
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/sales/discover/submit',
      headers,
      payload: {
        title: '  Rebuild our booking system  ',
        company: 'Acme',
        requiredSkills: ['react', 'nodejs'],
        estimatedBudget: 12000,
        urgency: 'start next month',
      },
    });
    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body);
    expect(body.opportunity.title).toBe('Rebuild our booking system');
    expect(body.opportunity.source).toBe('user-submitted');
    expect(body.opportunity.sourceReliability).toBe('HIGH');
    expect(body.type).toBe('POTENTIAL_CLIENT');

    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/sales/opportunities',
      headers,
    });
    const { opportunities } = JSON.parse(list.body);
    expect(opportunities).toHaveLength(1);
    expect(opportunities[0].requiredSkills).toEqual(['react', 'nodejs']);
  });

  it('creates, lists, updates, and deletes offers', async () => {
    const headers = await authHeaders('offers@example.com');
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/sales/offers',
      headers,
      payload: {
        name: 'Website + SEO launch',
        components: ['Website development', 'On-page SEO'],
        suggestedPrice: 3200,
        minimumPrice: 1900,
        targetMargin: 40,
      },
    });
    expect(create.statusCode).toBe(201);
    const { offer } = JSON.parse(create.body);
    expect(offer.name).toBe('Website + SEO launch');
    expect(offer.components).toEqual(['Website development', 'On-page SEO']);
    expect(offer.status).toBe('DRAFT');

    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/sales/offers',
      headers,
    });
    const { offers } = JSON.parse(list.body);
    expect(offers).toHaveLength(1);
    expect(offers[0].suggestedPrice).toBe(3200);

    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/v1/sales/offers/${offer.id}`,
      headers,
      payload: { status: 'SENT', targetMargin: 45 },
    });
    expect(patch.statusCode).toBe(200);
    expect(JSON.parse(patch.body).offer.status).toBe('SENT');

    const remove = await app.inject({
      method: 'DELETE',
      url: `/api/v1/sales/offers/${offer.id}`,
      headers,
    });
    expect(remove.statusCode).toBe(204);

    const after = await app.inject({
      method: 'GET',
      url: '/api/v1/sales/offers',
      headers,
    });
    expect(JSON.parse(after.body).offers).toHaveLength(0);
  });

  it('analyzes margin for a price', async () => {
    const headers = await authHeaders('margin@example.com');
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/sales/margin',
      headers,
      payload: { targetPrice: 1400, targetMargin: 40, estimatedCost: 700 },
    });
    expect(response.statusCode).toBe(200);
    const { analysis } = JSON.parse(response.body);
    expect(analysis.estimatedMarginPercent).toBe(50);
    expect(analysis.status).toBe('healthy');
  });

  it('requires AI configuration for persona, offer design, objections, and negotiation', async () => {
    const headers = await authHeaders('ai-gated@example.com');
    for (const url of [
      '/api/v1/sales/persona',
      '/api/v1/sales/offers/design',
      '/api/v1/sales/objections',
      '/api/v1/sales/negotiation',
    ]) {
      const response = await app.inject({
        method: 'POST',
        url,
        headers,
        payload: { companyName: 'Acme' },
      });
      expect(response.statusCode).toBe(503);
    }
  });

  it('creates and lists leads', async () => {
    const headers = await authHeaders('leads@example.com');
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/sales/leads',
      headers,
      payload: { name: 'Jane Smith', company: 'Acme', email: 'jane@acme.com' },
    });
    expect(create.statusCode).toBe(201);
    const { lead } = JSON.parse(create.body);
    expect(lead.status).toBe('NEW');

    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/sales/leads',
      headers,
    });
    expect(JSON.parse(list.body).leads).toHaveLength(1);
  });

  it('enforces pipeline transition rules on lead updates', async () => {
    const headers = await authHeaders('pipeline@example.com');
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/sales/leads',
      headers,
      payload: { name: 'Bob' },
    });
    const { lead } = JSON.parse(create.body);

    const forward = await app.inject({
      method: 'PATCH',
      url: `/api/v1/sales/leads/${lead.id}`,
      headers,
      payload: { status: 'PROPOSAL' },
    });
    expect(forward.statusCode).toBe(200);

    const win = await app.inject({
      method: 'PATCH',
      url: `/api/v1/sales/leads/${lead.id}`,
      headers,
      payload: { status: 'WON' },
    });
    expect(win.statusCode).toBe(200);
    expect(JSON.parse(win.body).lead.status).toBe('WON');

    const reopen = await app.inject({
      method: 'PATCH',
      url: `/api/v1/sales/leads/${lead.id}`,
      headers,
      payload: { status: 'NEGOTIATION' },
    });
    expect(reopen.statusCode).toBe(409);
  });

  it('blocks winning a lead directly from NEW', async () => {
    const headers = await authHeaders('nowin@example.com');
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/sales/leads',
      headers,
      payload: { name: 'Carol' },
    });
    const { lead } = JSON.parse(create.body);

    const win = await app.inject({
      method: 'PATCH',
      url: `/api/v1/sales/leads/${lead.id}`,
      headers,
      payload: { status: 'WON' },
    });
    expect(win.statusCode).toBe(409);
  });

  it('computes a pipeline overview with value and conversion', async () => {
    const headers = await authHeaders('overview@example.com');
    const a = await app.inject({
      method: 'POST',
      url: '/api/v1/sales/leads',
      headers,
      payload: { name: 'A', estimatedValue: 2000, status: 'MEETING' },
    });
    const b = await app.inject({
      method: 'POST',
      url: '/api/v1/sales/leads',
      headers,
      payload: { name: 'B', estimatedValue: 3000, status: 'PROPOSAL' },
    });
    const leadA = JSON.parse(a.body).lead;
    const leadB = JSON.parse(b.body).lead;

    const winRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/sales/leads/${leadA.id}`,
      headers,
      payload: { status: 'WON' },
    });
    expect(winRes.statusCode).toBe(200);
    const loseRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/sales/leads/${leadB.id}`,
      headers,
      payload: { status: 'LOST' },
    });
    expect(loseRes.statusCode).toBe(200);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/sales/overview',
      headers,
    });
    expect(response.statusCode).toBe(200);
    const overview = JSON.parse(response.body);
    expect(overview.dealsWon).toBe(1);
    expect(overview.dealsLost).toBe(1);
    expect(overview.conversionRate).toBe(50);
    expect(overview.byStage.NEW).toBe(0);
  });

  it('creates a draft that requires approval before sending', async () => {
    const headers = await authHeaders('drafts@example.com');
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/sales/drafts',
      headers,
      payload: {
        kind: 'COLD_EMAIL',
        recipientName: 'Jane',
        recipientEmail: 'jane@acme.com',
        subject: 'Quick question',
        content: 'Hi Jane, ...',
      },
    });
    expect(create.statusCode).toBe(201);
    const { draft } = JSON.parse(create.body);
    expect(draft.status).toBe('DRAFT');

    const sendWithoutApproval = await app.inject({
      method: 'POST',
      url: `/api/v1/sales/drafts/${draft.id}/send`,
      headers,
    });
    expect(sendWithoutApproval.statusCode).toBe(400);

    const approve = await app.inject({
      method: 'POST',
      url: `/api/v1/sales/drafts/${draft.id}/approve`,
      headers,
    });
    expect(approve.statusCode).toBe(200);
    expect(JSON.parse(approve.body).draft.status).toBe('APPROVED');

    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/sales/drafts',
      headers,
    });
    expect(JSON.parse(list.body).drafts).toHaveLength(1);
  });

  it('refuses to edit an approved draft', async () => {
    const headers = await authHeaders('locked@example.com');
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/sales/drafts',
      headers,
      payload: { content: 'v1' },
    });
    const { draft } = JSON.parse(create.body);
    await app.inject({
      method: 'POST',
      url: `/api/v1/sales/drafts/${draft.id}/approve`,
      headers,
    });
    const edit = await app.inject({
      method: 'PATCH',
      url: `/api/v1/sales/drafts/${draft.id}`,
      headers,
      payload: { content: 'v2' },
    });
    expect(edit.statusCode).toBe(400);
  });

  it('scopes all resources to the current user', async () => {
    const owner = await authHeaders('owner@example.com');
    const intruder = await authHeaders('intruder@example.com');

    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/sales/leads',
      headers: owner,
      payload: { name: 'Secret lead' },
    });
    const { lead } = JSON.parse(create.body);

    const read = await app.inject({
      method: 'GET',
      url: `/api/v1/sales/leads/${lead.id}`,
      headers: intruder,
    });
    expect(read.statusCode).toBe(404);

    const remove = await app.inject({
      method: 'DELETE',
      url: `/api/v1/sales/leads/${lead.id}`,
      headers: intruder,
    });
    expect(remove.statusCode).toBe(404);

    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/sales/leads',
      headers: intruder,
    });
    expect(JSON.parse(list.body).leads).toEqual([]);
  });

  it('stores company research and lists it without findings', async () => {
    const headers = await authHeaders('research@example.com');
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/sales/research',
      headers,
      payload: { companyName: 'Acme', website: 'https://acme.example.com' },
    });
    expect(create.statusCode).toBe(201);
    const { record } = JSON.parse(create.body);
    expect(record.findings).toBeDefined();

    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/sales/research',
      headers,
    });
    const { records } = JSON.parse(list.body);
    expect(records).toHaveLength(1);
    expect(records[0].findings).toBeUndefined();
  });

  it('returns 503 for pitch generation when no AI provider is configured', async () => {
    const headers = await authHeaders('noai@example.com');
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/sales/pitch',
      headers,
      payload: { kind: 'COLD_EMAIL', company: 'Acme' },
    });
    expect(response.statusCode).toBe(503);
  });

  it('rejects an invalid lead payload with 400', async () => {
    const headers = await authHeaders('badlead@example.com');
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/sales/leads',
      headers,
      payload: { name: '' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('records audit events when creating sales records', async () => {
    const headers = await authHeaders('audit@example.com');

    const opp = await app.inject({
      method: 'POST',
      url: '/api/v1/sales/opportunities',
      headers,
      payload: { title: 'Audit me', type: 'POTENTIAL_CLIENT' },
    });
    expect(opp.statusCode).toBe(201);
    const { opportunity } = JSON.parse(opp.body);

    const offer = await app.inject({
      method: 'POST',
      url: '/api/v1/sales/offers',
      headers,
      payload: { name: 'Audit offer' },
    });
    expect(offer.statusCode).toBe(201);
    const { offer: createdOffer } = JSON.parse(offer.body);

    const lead = await app.inject({
      method: 'POST',
      url: '/api/v1/sales/leads',
      headers,
      payload: { name: 'Audit lead' },
    });
    expect(lead.statusCode).toBe(201);
    const { lead: createdLead } = JSON.parse(lead.body);

    const draft = await app.inject({
      method: 'POST',
      url: '/api/v1/sales/drafts',
      headers,
      payload: { content: 'Hello' },
    });
    expect(draft.statusCode).toBe(201);
    const { draft: createdDraft } = JSON.parse(draft.body);

    const approve = await app.inject({
      method: 'POST',
      url: `/api/v1/sales/drafts/${createdDraft.id}/approve`,
      headers,
    });
    expect(approve.statusCode).toBe(200);

    const logs = getAuditLogs(50);
    const actions = logs.map((entry) => entry.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'sales.opportunity.create',
        'sales.offer.create',
        'sales.lead.create',
        'sales.draft.create',
        'sales.draft.approve',
      ]),
    );

    const oppEvent = logs.find((entry) => entry.target === opportunity.id);
    expect(oppEvent?.action).toBe('sales.opportunity.create');
    expect(oppEvent?.actorEmail).toBe('audit@example.com');

    const offerEvent = logs.find((entry) => entry.target === createdOffer.id);
    expect(offerEvent?.detail).toContain('Audit offer');

    const leadEvent = logs.find((entry) => entry.target === createdLead.id);
    expect(leadEvent?.action).toBe('sales.lead.create');
  });

  it('records audit events for updates, deletes, and re-scores', async () => {
    const headers = await authHeaders('audit2@example.com');

    const lead = await app.inject({
      method: 'POST',
      url: '/api/v1/sales/leads',
      headers,
      payload: { name: 'Doomed lead' },
    });
    const { lead: createdLead } = JSON.parse(lead.body);

    const update = await app.inject({
      method: 'PATCH',
      url: `/api/v1/sales/leads/${createdLead.id}`,
      headers,
      payload: { status: 'QUALIFIED' },
    });
    expect(update.statusCode).toBe(200);

    const opp = await app.inject({
      method: 'POST',
      url: '/api/v1/sales/opportunities',
      headers,
      payload: { title: 'Score me', type: 'JOB', estimatedBudget: 1500 },
    });
    const { opportunity } = JSON.parse(opp.body);
    const scored = await app.inject({
      method: 'POST',
      url: `/api/v1/sales/opportunities/${opportunity.id}/score`,
      headers,
    });
    expect(scored.statusCode).toBe(200);

    const remove = await app.inject({
      method: 'DELETE',
      url: `/api/v1/sales/leads/${createdLead.id}`,
      headers,
    });
    expect(remove.statusCode).toBe(204);

    const logs = getAuditLogs(50);
    const actions = logs.map((entry) => entry.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'sales.lead.create',
        'sales.lead.update',
        'sales.lead.delete',
        'sales.opportunity.create',
        'sales.opportunity.score',
      ]),
    );
    expect(
      logs.find((entry) => entry.target === createdLead.id && entry.action === 'sales.lead.create')
        ?.action,
    ).toBe('sales.lead.create');
    expect(
      logs.find((entry) => entry.target === createdLead.id && entry.action === 'sales.lead.delete')
        ?.detail,
    ).toContain('Doomed lead');
  });
});

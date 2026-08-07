import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

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

type MockMemory = {
  id: string;
  userId: string;
  key: string;
  value: string;
  category: string | null;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
};

const { mockPrisma, resetDb, registerAndLogin } = vi.hoisted(() => {
  const users = new Map<string, MockUser>();
  const sessions = new Map<string, MockSession>();
  const memories = new Map<string, MockMemory>();

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

  function makeMemory(
    userId: string,
    key: string,
    value: string,
    category: string | null,
    metadata: unknown = null,
  ): MockMemory {
    const now = new Date();
    return {
      id: randomUUID(),
      userId,
      key,
      value,
      category,
      metadata,
      createdAt: now,
      updatedAt: now,
    };
  }

  const memoryModel = {
    async findMany(args: {
      where?: { userId?: string };
      orderBy?: { updatedAt?: 'asc' | 'desc' };
      select?: unknown;
    }): Promise<MockMemory[]> {
      let list = [...memories.values()];
      if (args.where?.userId) {
        list = list.filter((memory) => memory.userId === args.where?.userId);
      }
      if (args.orderBy?.updatedAt === 'desc') {
        list.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
      }
      return list;
    },
    async findUnique(args: {
      where: { userId_key: { userId: string; key: string } };
    }): Promise<MockMemory | null> {
      for (const memory of memories.values()) {
        if (
          memory.userId === args.where.userId_key.userId &&
          memory.key === args.where.userId_key.key
        ) {
          return memory;
        }
      }
      return null;
    },
    async findFirst(args: { where: { id?: string; userId?: string } }): Promise<MockMemory | null> {
      for (const memory of memories.values()) {
        if (args.where.id && memory.id !== args.where.id) {
          continue;
        }
        if (args.where.userId && memory.userId !== args.where.userId) {
          continue;
        }
        return memory;
      }
      return null;
    },
    async upsert(args: {
      where: { userId_key: { userId: string; key: string } };
      create: {
        userId: string;
        key: string;
        value: string;
        category: string | null;
        metadata?: unknown;
      };
      update: { value: string; category: string | null; metadata?: unknown };
      select?: unknown;
    }): Promise<MockMemory> {
      const existing = await memoryModel.findUnique({ where: args.where });
      if (existing) {
        const updated: MockMemory = {
          ...existing,
          value: args.update.value,
          category: args.update.category,
          ...(args.update.metadata !== undefined ? { metadata: args.update.metadata } : {}),
          updatedAt: new Date(),
        };
        memories.set(updated.id, updated);
        return updated;
      }
      const memory = makeMemory(
        args.create.userId,
        args.create.key,
        args.create.value,
        args.create.category,
        args.create.metadata,
      );
      memories.set(memory.id, memory);
      return memory;
    },
    async update(args: {
      where: { id: string };
      data: { value?: string; category?: string | null; metadata?: unknown };
    }): Promise<MockMemory> {
      const memory = memories.get(args.where.id);
      if (!memory) {
        throw new Error('Memory not found');
      }
      const updated: MockMemory = {
        ...memory,
        ...(args.data.value !== undefined ? { value: args.data.value } : {}),
        ...(args.data.category !== undefined ? { category: args.data.category } : {}),
        ...(args.data.metadata !== undefined ? { metadata: args.data.metadata } : {}),
        updatedAt: new Date(),
      };
      memories.set(updated.id, updated);
      return updated;
    },
    async delete(args: { where: { id: string } }): Promise<MockMemory> {
      const memory = memories.get(args.where.id);
      if (memory) {
        memories.delete(args.where.id);
      }
      return memory ?? ({} as MockMemory);
    },
    async deleteMany(args: {
      where: { id?: string; userId?: string };
    }): Promise<{ count: number }> {
      const targets = [...memories.values()].filter((memory) => {
        if (args.where.id && memory.id !== args.where.id) {
          return false;
        }
        if (args.where.userId && memory.userId !== args.where.userId) {
          return false;
        }
        return true;
      });
      for (const target of targets) {
        memories.delete(target.id);
      }
      return { count: targets.length };
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
    const session: MockSession = {
      id: randomUUID(),
      userId: user.id,
      token: `token-${user.id}`,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      createdAt: now,
      updatedAt: now,
    };
    sessions.set(session.id, session);

    const { signAccessToken } = await import('../src/lib/jwt.js');
    return signAccessToken(user.id, user.role);
  }

  return {
    mockPrisma: {
      user: userModel,
      session: sessionModel,
      memory: memoryModel,
      $disconnect: async (): Promise<void> => undefined,
    },
    resetDb: (): void => {
      users.clear();
      sessions.clear();
      memories.clear();
    },
    registerAndLogin,
  };
});

vi.mock('../src/lib/prisma.js', () => ({ prisma: mockPrisma }));

describe('memories', () => {
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
  });

  async function authHeaders(email: string): Promise<{ authorization: string }> {
    const token = await registerAndLogin(email);
    return { authorization: `Bearer ${token}` };
  }

  it('creates, lists, patches and deletes a memory', async () => {
    const headers = await authHeaders('owner@example.com');

    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/memories',
      headers,
      payload: { key: 'name', value: 'Alice', category: 'personal' },
    });
    expect(create.statusCode).toBe(201);
    const { memory } = JSON.parse(create.body);
    expect(memory.key).toBe('name');
    expect(memory.value).toBe('Alice');
    expect(memory.category).toBe('personal');

    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/memories',
      headers,
    });
    expect(list.statusCode).toBe(200);
    const { memories } = JSON.parse(list.body);
    expect(memories).toHaveLength(1);
    expect(memories[0].id).toBe(memory.id);

    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/v1/memories/${memory.id}`,
      headers,
      payload: { value: 'Alex' },
    });
    expect(patch.statusCode).toBe(200);
    expect(JSON.parse(patch.body).memory.value).toBe('Alex');

    const remove = await app.inject({
      method: 'DELETE',
      url: `/api/v1/memories/${memory.id}`,
      headers,
    });
    expect(remove.statusCode).toBe(204);

    const after = await app.inject({
      method: 'GET',
      url: '/api/v1/memories',
      headers,
    });
    expect(JSON.parse(after.body).memories).toEqual([]);
  });

  it('upserts a memory by key, returning 200 when it already exists', async () => {
    const headers = await authHeaders('upsert@example.com');

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/memories',
      headers,
      payload: { key: 'timezone', value: 'UTC' },
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/memories',
      headers,
      payload: { key: 'timezone', value: 'Europe/Berlin' },
    });
    expect(second.statusCode).toBe(200);
    const { memory } = JSON.parse(second.body);
    expect(memory.value).toBe('Europe/Berlin');

    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/memories',
      headers,
    });
    expect(JSON.parse(list.body).memories).toHaveLength(1);
  });

  it('scopes memories to the current user', async () => {
    const owner = await authHeaders('owner@example.com');
    const intruder = await authHeaders('intruder@example.com');

    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/memories',
      headers: owner,
      payload: { key: 'secret', value: 'mine' },
    });
    const { memory } = JSON.parse(create.body);

    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/memories',
      headers: intruder,
    });
    expect(JSON.parse(list.body).memories).toEqual([]);

    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/v1/memories/${memory.id}`,
      headers: intruder,
      payload: { value: 'stolen' },
    });
    expect(patch.statusCode).toBe(404);

    const remove = await app.inject({
      method: 'DELETE',
      url: `/api/v1/memories/${memory.id}`,
      headers: intruder,
    });
    expect(remove.statusCode).toBe(404);
  });

  it('requires authentication', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/memories' });
    expect(response.statusCode).toBe(401);
  });

  it('rejects an invalid body with 400', async () => {
    const headers = await authHeaders('bad@example.com');

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/memories',
      headers,
      payload: { key: '', value: 'x' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('stores kind, importance and tags in memory metadata', async () => {
    const headers = await authHeaders('rich@example.com');

    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/memories',
      headers,
      payload: {
        key: 'stage-8',
        value: 'ship long term memory',
        category: 'work',
        kind: 'project',
        importance: 9,
        tags: ['bro', 'roadmap'],
      },
    });
    expect(create.statusCode).toBe(201);
    const { memory } = JSON.parse(create.body);
    expect(memory.kind).toBe('project');
    expect(memory.importance).toBe(9);
    expect(memory.tags).toEqual(['bro', 'roadmap']);
    expect(memory.accessCount).toBe(0);

    const list = await app.inject({ method: 'GET', url: '/api/v1/memories', headers });
    expect(JSON.parse(list.body).memories[0].kind).toBe('project');
  });

  it('patches kind, importance and tags while preserving recall stats', async () => {
    const headers = await authHeaders('patch@example.com');

    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/memories',
      headers,
      payload: { key: 'client', value: 'Acme', kind: 'client', importance: 6 },
    });
    const { memory } = JSON.parse(create.body);

    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/v1/memories/${memory.id}`,
      headers,
      payload: { importance: 8, tags: ['acme', 'enterprise'] },
    });
    expect(patch.statusCode).toBe(200);
    const patched = JSON.parse(patch.body).memory;
    expect(patched.importance).toBe(8);
    expect(patched.tags).toEqual(['acme', 'enterprise']);
    expect(patched.kind).toBe('client');
  });

  it('searches memories by semantic relevance', async () => {
    const headers = await authHeaders('search@example.com');

    await app.inject({
      method: 'POST',
      url: '/api/v1/memories',
      headers,
      payload: { key: 'name', value: 'Alice' },
    });
    await app.inject({
      method: 'POST',
      url: '/api/v1/memories',
      headers,
      payload: { key: 'city', value: 'lives in Paris' },
    });

    const search = await app.inject({
      method: 'GET',
      url: '/api/v1/memories?q=where%20does%20she%20live',
      headers,
    });
    expect(search.statusCode).toBe(200);
    const { memories } = JSON.parse(search.body);
    expect(memories[0].key).toBe('city');
  });

  it('filters memories by category and kind', async () => {
    const headers = await authHeaders('filter@example.com');

    await app.inject({
      method: 'POST',
      url: '/api/v1/memories',
      headers,
      payload: { key: 'project', value: 'stage 8', category: 'work', kind: 'project' },
    });
    await app.inject({
      method: 'POST',
      url: '/api/v1/memories',
      headers,
      payload: { key: 'name', value: 'Alice', category: 'personal' },
    });

    const byCategory = await app.inject({
      method: 'GET',
      url: '/api/v1/memories?category=personal',
      headers,
    });
    const categoryResult = JSON.parse(byCategory.body).memories;
    expect(categoryResult).toHaveLength(1);
    expect(categoryResult[0].key).toBe('name');

    const byKind = await app.inject({
      method: 'GET',
      url: '/api/v1/memories?kind=project',
      headers,
    });
    const kindResult = JSON.parse(byKind.body).memories;
    expect(kindResult).toHaveLength(1);
    expect(kindResult[0].key).toBe('project');
  });

  it('returns a timeline grouped by recency', async () => {
    const headers = await authHeaders('timeline@example.com');

    await app.inject({
      method: 'POST',
      url: '/api/v1/memories',
      headers,
      payload: { key: 'note', value: 'a fresh memory' },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/memories/timeline',
      headers,
    });
    expect(response.statusCode).toBe(200);
    const { groups } = JSON.parse(response.body);
    expect(Array.isArray(groups)).toBe(true);
    expect(groups.length).toBeGreaterThan(0);
    expect(groups[0].label).toBe('Today');
    expect(groups[0].items[0].key).toBe('note');
    expect(groups[0].items[0].activity).toBe('updated');
  });

  it('returns a null memory digest when no AI provider is configured', async () => {
    const headers = await authHeaders('digest@example.com');

    await app.inject({
      method: 'POST',
      url: '/api/v1/memories',
      headers,
      payload: { key: 'name', value: 'Alice' },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/memories/summary',
      headers,
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ summary: null });
  });
});

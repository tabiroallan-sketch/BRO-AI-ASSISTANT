import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { logger } from '../src/lib/logger.js';
import { config } from '../src/config/index.js';

type MockUser = {
  id: string;
  email: string;
  role: 'USER' | 'ADMIN';
  isActive: boolean;
};

type MockSession = {
  id: string;
  userId: string;
  token: string;
  expiresAt: Date;
};

type MockConversation = {
  id: string;
  userId: string;
  title: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type MockMessage = {
  id: string;
  conversationId: string;
  role: 'USER' | 'ASSISTANT' | 'SYSTEM';
  content: string;
  createdAt: Date;
};

const { mockPrisma, resetDb, registerAndLogin, getUserId, seed } = vi.hoisted(() => {
  process.env.DATABASE_URL = '';
  process.env.REDIS_URL = '';
  process.env.JWT_SECRET = 'test-access-secret';
  process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
  process.env.JWT_EXPIRES_IN = '15m';
  process.env.JWT_REFRESH_EXPIRES_IN = '7d';
  process.env.N8N_BASE_URL = 'http://n8n.test';
  process.env.N8N_API_KEY = 'test-key';

  const users = new Map<string, MockUser>();
  const sessions = new Map<string, MockSession>();
  const conversations = new Map<string, MockConversation>();
  const messages = new Map<string, MockMessage>();
  const memories = new Map<string, { id: string; userId: string }>();
  const integrations = new Map<string, { id: string; userId: string }>();
  const notifications = new Map<string, { id: string; userId: string }>();

  const userModel = {
    async findUnique(args: { where: { id: string } }): Promise<MockUser | null> {
      return users.get(args.where.id) ?? null;
    },
  };

  const sessionModel = {
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
  };

  const conversationModel = {
    async count(args: { where: { userId: string } }): Promise<number> {
      return [...conversations.values()].filter(
        (conversation) => conversation.userId === args.where.userId,
      ).length;
    },
  };

  const memoryModel = {
    async count(args: { where: { userId: string } }): Promise<number> {
      return [...memories.values()].filter((memory) => memory.userId === args.where.userId).length;
    },
  };

  const integrationModel = {
    async count(args: { where: { userId: string } }): Promise<number> {
      return [...integrations.values()].filter(
        (integration) => integration.userId === args.where.userId,
      ).length;
    },
  };

  const notificationModel = {
    async count(args: { where: { userId: string } }): Promise<number> {
      return [...notifications.values()].filter(
        (notification) => notification.userId === args.where.userId,
      ).length;
    },
  };

  const messageModel = {
    async count(args: {
      where: { conversation?: { userId?: string }; role?: string };
    }): Promise<number> {
      let list = [...messages.values()];
      if (args.where.conversation?.userId) {
        list = list.filter(
          (message) =>
            conversations.get(message.conversationId)?.userId === args.where.conversation?.userId,
        );
      }
      if (args.where.role) {
        list = list.filter((message) => message.role === args.where.role);
      }
      return list.length;
    },
    async findMany(args: {
      where: { conversation?: { userId?: string }; createdAt?: { gte?: Date } };
      select?: unknown;
      orderBy?: { createdAt?: 'asc' | 'desc' };
    }): Promise<Array<{ createdAt: Date }>> {
      let list = [...messages.values()];
      if (args.where.conversation?.userId) {
        list = list.filter(
          (message) =>
            conversations.get(message.conversationId)?.userId === args.where.conversation?.userId,
        );
      }
      if (args.where.createdAt?.gte) {
        list = list.filter((message) => message.createdAt >= (args.where.createdAt?.gte as Date));
      }
      if (args.orderBy?.createdAt === 'asc') {
        list.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      }
      return list.map((message) => ({ createdAt: message.createdAt }));
    },
  };

  async function registerAndLogin(email: string, role: 'USER' | 'ADMIN' = 'USER'): Promise<string> {
    const user: MockUser = {
      id: randomUUID(),
      email,
      role,
      isActive: true,
    };
    users.set(user.id, user);
    const session: MockSession = {
      id: randomUUID(),
      userId: user.id,
      token: `token-${user.id}`,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60),
    };
    sessions.set(session.id, session);

    const { signAccessToken } = await import('../src/lib/jwt.js');
    return signAccessToken(user.id, role);
  }

  function getUserId(email: string): string {
    for (const user of users.values()) {
      if (user.email === email) {
        return user.id;
      }
    }
    return '';
  }

  function seedConversation(userId: string, title: string | null = null): MockConversation {
    const now = new Date();
    const conversation: MockConversation = {
      id: randomUUID(),
      userId,
      title,
      createdAt: now,
      updatedAt: now,
    };
    conversations.set(conversation.id, conversation);
    return conversation;
  }

  function seedMessage(
    conversationId: string,
    role: MockMessage['role'],
    content: string,
    createdAt?: Date,
  ): void {
    messages.set(randomUUID(), {
      id: randomUUID(),
      conversationId,
      role,
      content,
      createdAt: createdAt ?? new Date(Date.now() - 60_000),
    });
  }

  function seedMemory(userId: string): void {
    memories.set(randomUUID(), { id: randomUUID(), userId });
  }

  function seedIntegration(userId: string): void {
    integrations.set(randomUUID(), { id: randomUUID(), userId });
  }

  function seedNotification(userId: string): void {
    notifications.set(randomUUID(), { id: randomUUID(), userId });
  }

  return {
    mockPrisma: {
      user: userModel,
      session: sessionModel,
      conversation: conversationModel,
      memory: memoryModel,
      integration: integrationModel,
      notification: notificationModel,
      message: messageModel,
      $disconnect: async (): Promise<void> => undefined,
    },
    resetDb: (): void => {
      users.clear();
      sessions.clear();
      conversations.clear();
      messages.clear();
      memories.clear();
      integrations.clear();
      notifications.clear();
    },
    registerAndLogin,
    getUserId,
    seed: { seedConversation, seedMessage, seedMemory, seedIntegration, seedNotification },
  };
});

vi.mock('../src/lib/prisma.js', () => ({ prisma: mockPrisma }));

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as unknown as Response;
}

let failN8n = false;

const mockFetch = vi.fn(async (input: unknown): Promise<Response> => {
  if (failN8n) {
    throw new Error('n8n unreachable');
  }
  const url = String(input);
  if (url.includes('/api/v1/workflows')) {
    return jsonResponse({
      data: [
        { id: 'wf-1', name: 'Onboarding', active: true },
        { id: 'wf-2', name: 'Daily digest', active: false },
      ],
    });
  }
  if (url.includes('/api/v1/executions')) {
    return jsonResponse({
      count: 2,
      executions: [
        {
          id: 'ex-1',
          workflowId: 'wf-1',
          workflowData: { name: 'Onboarding' },
          status: 'success',
          startedAt: '2026-01-01T00:00:00.000Z',
          stoppedAt: '2026-01-01T00:00:01.000Z',
        },
        {
          id: 'ex-2',
          workflowId: 'wf-2',
          workflowData: { name: 'Daily digest' },
          finished: true,
          startedAt: '2026-01-01T00:00:00.000Z',
          stoppedAt: '2026-01-01T00:00:02.000Z',
        },
      ],
    });
  }
  return jsonResponse({ data: [] });
});

describe('dashboard endpoints', () => {
  let app: FastifyInstance;
  const originalFetch = globalThis.fetch;

  beforeAll(async () => {
    globalThis.fetch = mockFetch as unknown as typeof fetch;
    const { buildApp } = await import('../src/app.js');
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    globalThis.fetch = originalFetch;
    await app.close();
  });

  beforeEach(() => {
    resetDb();
    failN8n = false;
  });

  afterEach(() => {
    (config as { n8nBaseUrl: string; n8nApiKey: string }).n8nBaseUrl = 'http://n8n.test';
    (config as { n8nBaseUrl: string; n8nApiKey: string }).n8nApiKey = 'test-key';
  });

  async function authHeaders(
    email: string,
    role: 'USER' | 'ADMIN' = 'USER',
  ): Promise<{ authorization: string }> {
    const token = await registerAndLogin(email, role);
    return { authorization: `Bearer ${token}` };
  }

  describe('GET /api/v1/tools', () => {
    it('lists installed tools', async () => {
      const headers = await authHeaders('tools@example.com');

      const response = await app.inject({ method: 'GET', url: '/api/v1/tools', headers });
      expect(response.statusCode).toBe(200);

      const { count, tools } = JSON.parse(response.body);
      expect(count).toBeGreaterThan(0);
      expect(tools.length).toBe(count);
      for (const tool of tools) {
        expect(typeof tool.name).toBe('string');
        expect(tool.name.length).toBeGreaterThan(0);
        expect(typeof tool.description).toBe('string');
      }
    });

    it('requires authentication', async () => {
      const response = await app.inject({ method: 'GET', url: '/api/v1/tools' });
      expect(response.statusCode).toBe(401);
    });
  });

  describe('GET /api/v1/automations', () => {
    it('returns workflow and execution status when n8n is configured', async () => {
      const headers = await authHeaders('automations@example.com', 'ADMIN');

      const response = await app.inject({ method: 'GET', url: '/api/v1/automations', headers });
      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.enabled).toBe(true);
      expect(body.configured).toBe(true);
      expect(body.error).toBeUndefined();

      expect(body.workflows).toEqual([
        { id: 'wf-1', name: 'Onboarding', active: true },
        { id: 'wf-2', name: 'Daily digest', active: false },
      ]);
      expect(body.executions).toHaveLength(2);
      expect(body.executions[0].status).toBe('success');
      expect(body.executions[0].workflowName).toBe('Onboarding');
      expect(body.executions[1].status).toBe('finished');
    });

    it('reports disabled when n8n is not configured', async () => {
      const headers = await authHeaders('automations-off@example.com', 'ADMIN');
      (config as { n8nBaseUrl: string; n8nApiKey: string }).n8nBaseUrl = '';
      (config as { n8nBaseUrl: string; n8nApiKey: string }).n8nApiKey = '';

      const response = await app.inject({ method: 'GET', url: '/api/v1/automations', headers });
      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.enabled).toBe(false);
      expect(body.configured).toBe(false);
      expect(body.workflows).toEqual([]);
      expect(body.executions).toEqual([]);
      expect(typeof body.error).toBe('string');
    });

    it('reports an error message when n8n is unreachable', async () => {
      const headers = await authHeaders('automations-error@example.com', 'ADMIN');
      failN8n = true;

      const response = await app.inject({ method: 'GET', url: '/api/v1/automations', headers });
      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.enabled).toBe(true);
      expect(body.error).toContain('n8n unreachable');
    });

    it('requires authentication', async () => {
      const response = await app.inject({ method: 'GET', url: '/api/v1/automations' });
      expect(response.statusCode).toBe(401);
    });
  });

  describe('GET /api/v1/analytics', () => {
    it('returns totals, role breakdown and daily activity', async () => {
      const email = 'analytics@example.com';
      const token = await registerAndLogin(email);
      const userId = getUserId(email);
      const conversation = seed.seedConversation(userId, 'Analytics chat');
      seed.seedMessage(conversation.id, 'USER', 'hello');
      seed.seedMessage(conversation.id, 'USER', 'again');
      seed.seedMessage(conversation.id, 'ASSISTANT', 'hi there');
      seed.seedMemory(userId);
      seed.seedMemory(userId);
      seed.seedIntegration(userId);
      seed.seedNotification(userId);
      seed.seedNotification(userId);
      seed.seedNotification(userId);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/analytics',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.totals).toEqual({
        conversations: 1,
        memories: 2,
        integrations: 1,
        notifications: 3,
        messages: 3,
      });
      expect(body.messagesByRole).toEqual({ user: 2, assistant: 1 });
      expect(body.daily).toHaveLength(14);
      const dailyTotal = body.daily.reduce(
        (sum: number, day: { count: number }) => sum + day.count,
        0,
      );
      expect(dailyTotal).toBe(3);
    });

    it('returns zeros for a user without activity', async () => {
      const headers = await authHeaders('empty@example.com');

      const response = await app.inject({ method: 'GET', url: '/api/v1/analytics', headers });
      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.totals).toEqual({
        conversations: 0,
        memories: 0,
        integrations: 0,
        notifications: 0,
        messages: 0,
      });
      expect(body.messagesByRole).toEqual({ user: 0, assistant: 0 });
      expect(body.daily.every((day: { count: number }) => day.count === 0)).toBe(true);
    });

    it('requires authentication', async () => {
      const response = await app.inject({ method: 'GET', url: '/api/v1/analytics' });
      expect(response.statusCode).toBe(401);
    });
  });

  describe('GET /api/v1/logs', () => {
    it('returns recent log entries and supports clearing', async () => {
      const headers = await authHeaders('logs@example.com', 'ADMIN');
      logger.info('dashboard-test-marker');

      const response = await app.inject({ method: 'GET', url: '/api/v1/logs', headers });
      expect(response.statusCode).toBe(200);

      const { logs } = JSON.parse(response.body);
      expect(Array.isArray(logs)).toBe(true);
      expect(logs.some((entry: { msg: string }) => entry.msg === 'dashboard-test-marker')).toBe(
        true,
      );

      const clear = await app.inject({ method: 'DELETE', url: '/api/v1/logs', headers });
      expect(clear.statusCode).toBe(204);

      const after = await app.inject({ method: 'GET', url: '/api/v1/logs', headers });
      const cleared = JSON.parse(after.body).logs as Array<{ msg: string }>;
      expect(cleared.some((entry) => entry.msg === 'dashboard-test-marker')).toBe(false);
    });

    it('honours the limit query parameter', async () => {
      const headers = await authHeaders('logs-limit@example.com', 'ADMIN');

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/logs?limit=5',
        headers,
      });
      expect(response.statusCode).toBe(200);
      const { logs } = JSON.parse(response.body);
      expect(logs.length).toBeLessThanOrEqual(5);
    });

    it('requires authentication', async () => {
      const response = await app.inject({ method: 'GET', url: '/api/v1/logs' });
      expect(response.statusCode).toBe(401);
    });
  });
});

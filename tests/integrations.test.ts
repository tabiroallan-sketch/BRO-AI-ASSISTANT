import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

process.env.DATABASE_URL = '';
process.env.REDIS_URL = '';
process.env.JWT_SECRET = 'test-access-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
process.env.JWT_EXPIRES_IN = '15m';
process.env.JWT_REFRESH_EXPIRES_IN = '7d';
process.env.GITHUB_CLIENT_ID = 'test-github-client';
process.env.GITHUB_CLIENT_SECRET = 'test-github-secret';

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

type MockIntegration = {
  id: string;
  userId: string;
  provider: string;
  accountName: string | null;
  externalId: string | null;
  accessToken: string;
  refreshToken: string | null;
  tokenExpiresAt: Date | null;
  scopes: string | null;
  metadata: Record<string, unknown> | null;
};

const { mockPrisma, resetDb, registerAndLogin } = vi.hoisted(() => {
  const users = new Map<string, MockUser>();
  const sessions = new Map<string, MockSession>();
  const integrations = new Map<string, MockIntegration>();

  const userModel = {
    async findUnique(args: { where: { id?: string } }): Promise<MockUser | null> {
      if (args.where.id !== undefined) {
        return users.get(args.where.id) ?? null;
      }
      return null;
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

  const integrationModel = {
    async findUnique(args: {
      where: { userId_provider: { userId: string; provider: string } };
    }): Promise<MockIntegration | null> {
      const key = `${args.where.userId_provider.userId}:${args.where.userId_provider.provider}`;
      return integrations.get(key) ?? null;
    },
    async findMany(args: { where: { userId?: string } }): Promise<MockIntegration[]> {
      const matches: MockIntegration[] = [];
      for (const integration of integrations.values()) {
        if (args.where.userId === undefined || integration.userId === args.where.userId) {
          matches.push(integration);
        }
      }
      return matches;
    },
    async upsert(args: {
      where: { userId_provider: { userId: string; provider: string } };
      update: Partial<MockIntegration>;
      create: MockIntegration;
    }): Promise<MockIntegration> {
      const { userId, provider } = args.where.userId_provider;
      const key = `${userId}:${provider}`;
      const existing = integrations.get(key);
      const record: MockIntegration = existing
        ? { ...existing, ...args.update, userId, provider }
        : { ...args.create, userId, provider };
      integrations.set(key, record);
      return record;
    },
    async deleteMany(args: {
      where: { userId?: string; provider?: string };
    }): Promise<{ count: number }> {
      let count = 0;
      for (const [key, integration] of integrations.entries()) {
        if (
          (args.where.userId === undefined || integration.userId === args.where.userId) &&
          (args.where.provider === undefined || integration.provider === args.where.provider)
        ) {
          integrations.delete(key);
          count += 1;
        }
      }
      return { count };
    },
  };

  async function registerAndLogin(email: string): Promise<{ token: string; userId: string }> {
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
    return { token: await signAccessToken(user.id, user.role), userId: user.id };
  }

  return {
    mockPrisma: {
      user: userModel,
      session: sessionModel,
      integration: integrationModel,
      $disconnect: async (): Promise<void> => undefined,
    },
    resetDb: (): void => {
      users.clear();
      sessions.clear();
      integrations.clear();
    },
    registerAndLogin,
  };
});

vi.mock('../src/lib/prisma.js', () => ({ prisma: mockPrisma }));

describe('integrations', () => {
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
    vi.restoreAllMocks();
  });

  async function authSession(email: string): Promise<{ authorization: string; userId: string }> {
    const { token, userId } = await registerAndLogin(email);
    return { authorization: `Bearer ${token}`, userId };
  }

  it('lists providers with connection status', async () => {
    const { authorization, userId } = await authSession('owner@example.com');
    const { signIntegrationState } = await import('../src/integrations/oauth.js');
    await import('../src/integrations/store.js').then(({ upsertIntegration }) =>
      upsertIntegration(userId, {
        provider: 'github',
        accessToken: 'gh_token_abc',
        accountName: 'octocat',
      }),
    );

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/integrations',
      headers: { authorization },
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    const providers = body.integrations as {
      id: string;
      connected: boolean;
      accountName: string | null;
      type: string;
    }[];
    expect(providers).toHaveLength(8);
    const github = providers.find((p) => p.id === 'github');
    expect(github?.connected).toBe(true);
    expect(github?.accountName).toBe('octocat');
    const calendar = providers.find((p) => p.id === 'google-calendar');
    expect(calendar?.connected).toBe(false);
    void signIntegrationState;
  });

  it('redirects to the GitHub authorize URL on connect when configured', async () => {
    const { authorization } = await authSession('owner@example.com');
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/integrations/github/connect',
      headers: { authorization },
    });
    expect(response.statusCode).toBe(302);
    const location = response.headers.location;
    expect(location).toContain('https://github.com/login/oauth/authorize');
    expect(location).toContain(
      `redirect_uri=${encodeURIComponent('http://localhost:3000/api/v1/integrations/github/callback')}`,
    );
    expect(location).toContain('state=');
  });

  it('returns 503 for OAuth connect when credentials are not configured', async () => {
    const { authorization } = await authSession('owner@example.com');
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/integrations/slack/connect',
      headers: { authorization },
    });
    expect(response.statusCode).toBe(503);
    expect(JSON.parse(response.body).error.message).toContain('not configured');
  });

  it('stores a Discord webhook integration via POST', async () => {
    const { authorization } = await authSession('owner@example.com');
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/integrations/discord',
      headers: { authorization },
      payload: { webhookUrl: 'https://discord.com/api/webhooks/123/abc' },
    });
    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body);
    expect(body.connected).toBe(true);

    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/integrations',
      headers: { authorization },
    });
    const discord = JSON.parse(list.body).integrations.find(
      (p: { id: string }) => p.id === 'discord',
    );
    expect(discord.connected).toBe(true);
    expect(discord.accountName).toBe('Discord webhook');
  });

  it('rejects an invalid Discord webhook URL', async () => {
    const { authorization } = await authSession('owner@example.com');
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/integrations/discord',
      headers: { authorization },
      payload: { webhookUrl: 'https://example.com/not-a-webhook' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('stores WhatsApp credentials via POST', async () => {
    const { authorization } = await authSession('owner@example.com');
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/integrations/whatsapp',
      headers: { authorization },
      payload: { token: 'wa_token', phoneNumberId: '123456789' },
    });
    expect(response.statusCode).toBe(201);

    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/integrations',
      headers: { authorization },
    });
    const whatsapp = JSON.parse(list.body).integrations.find(
      (p: { id: string }) => p.id === 'whatsapp',
    );
    expect(whatsapp.connected).toBe(true);
    expect(whatsapp.accountName).toBe('Phone 123456789');
  });

  it('completes the OAuth callback and stores the connection', async () => {
    const { authorization, userId } = await authSession('owner@example.com');
    const { signIntegrationState } = await import('../src/integrations/oauth.js');
    const state = await signIntegrationState(userId, 'github');

    const fetchMock = vi.fn(async (input: string) => {
      const url = String(input);
      if (url.includes('api.github.com/user')) {
        return new Response(JSON.stringify({ login: 'octocat' }), { status: 200 });
      }
      if (url.includes('access_token')) {
        return new Response(
          JSON.stringify({ access_token: 'gh_token', scope: 'repo read:user', expires_in: 3600 }),
          { status: 200 },
        );
      }
      return new Response('Not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/integrations/github/callback?code=somecode&state=${state}`,
    });
    expect(response.statusCode).toBe(302);
    expect(String(response.headers.location)).toContain(
      '/settings?integration=github&status=connected',
    );

    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/integrations',
      headers: { authorization },
    });
    const github = JSON.parse(list.body).integrations.find(
      (p: { id: string }) => p.id === 'github',
    );
    expect(github.connected).toBe(true);
    expect(github.accountName).toBe('octocat');
  });

  it('redirects to settings with an error on an invalid OAuth state', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/integrations/github/callback?code=somecode&state=not-a-valid-state',
    });
    expect(response.statusCode).toBe(302);
    expect(String(response.headers.location)).toContain('status=error');
  });

  it('disconnects an integration', async () => {
    const { authorization, userId } = await authSession('owner@example.com');
    const { upsertIntegration } = await import('../src/integrations/store.js');
    await upsertIntegration(userId, {
      provider: 'github',
      accessToken: 'gh_token',
      accountName: 'octocat',
    });

    const response = await app.inject({
      method: 'DELETE',
      url: '/api/v1/integrations/github',
      headers: { authorization },
    });
    expect(response.statusCode).toBe(204);

    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/integrations',
      headers: { authorization },
    });
    const github = JSON.parse(list.body).integrations.find(
      (p: { id: string }) => p.id === 'github',
    );
    expect(github.connected).toBe(false);
  });

  it('requires authentication on protected routes', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/integrations' });
    expect(response.statusCode).toBe(401);
  });

  it('returns 404 for an unknown provider', async () => {
    const { authorization } = await authSession('owner@example.com');
    const response = await app.inject({
      method: 'DELETE',
      url: '/api/v1/integrations/unknown-provider',
      headers: { authorization },
    });
    expect(response.statusCode).toBe(404);
  });
});

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
  accountKey: string;
  accountName: string | null;
  externalId: string | null;
  accessToken: string;
  refreshToken: string | null;
  tokenExpiresAt: Date | null;
  scopes: string | null;
  metadata: Record<string, unknown> | null;
  isPrimary: boolean;
  refreshTokenHash: string | null;
  lastRefreshedAt: Date | null;
  refreshCount: number;
  revokedAt: Date | null;
  revokedReason: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type MockIntegrationStatus = {
  id: string;
  integrationId: string;
  status: string;
  ok: boolean;
  latencyMs: number | null;
  lastMessage: string | null;
  lastHealthCheckAt: Date;
  lastSuccessAt: Date | null;
  updatedAt: Date;
};

type MockPermissionSet = {
  id: string;
  integrationId: string;
  scopes: string[];
  permissionIds: string[];
  grantedAt: Date;
  updatedAt: Date;
};

type MockSyncRecord = {
  id: string;
  integrationId: string;
  kind: string;
  status: 'RUNNING' | 'SUCCESS' | 'FAILED';
  startedAt: Date;
  finishedAt: Date | null;
  itemCount: number | null;
  error: string | null;
  detail: Record<string, unknown> | null;
  createdAt: Date;
};

const { mockPrisma, resetDb, registerAndLogin } = vi.hoisted(() => {
  const users = new Map<string, MockUser>();
  const sessions = new Map<string, MockSession>();
  const integrations = new Map<string, MockIntegration>();
  const integrationStatuses = new Map<string, MockIntegrationStatus>();
  const permissionSets = new Map<string, MockPermissionSet>();
  const syncHistory = new Map<string, MockSyncRecord>();

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

  function integrationMatches(
    integration: MockIntegration,
    where: { userId?: string; provider?: string; isPrimary?: boolean },
  ): boolean {
    if (where.userId !== undefined && integration.userId !== where.userId) {
      return false;
    }
    if (where.provider !== undefined && integration.provider !== where.provider) {
      return false;
    }
    if (where.isPrimary !== undefined && integration.isPrimary !== where.isPrimary) {
      return false;
    }
    return true;
  }

  const integrationModel = {
    async findUnique(args: {
      where: {
        userId_provider_accountKey: { userId: string; provider: string; accountKey: string };
      };
    }): Promise<MockIntegration | null> {
      const { userId, provider, accountKey } = args.where.userId_provider_accountKey;
      return integrations.get(`${userId}:${provider}:${accountKey}`) ?? null;
    },
    async findFirst(args: {
      where: { userId: string; provider: string; isPrimary?: boolean };
      orderBy?: { createdAt?: 'asc' | 'desc' };
    }): Promise<MockIntegration | null> {
      const matches = [...integrations.values()].filter((integration) =>
        integrationMatches(integration, args.where),
      );
      if (args.orderBy?.createdAt === 'desc') {
        matches.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      }
      return matches[0] ?? null;
    },
    async findMany(args: {
      where: { userId?: string; provider?: string };
      orderBy?: { isPrimary?: 'asc' | 'desc'; createdAt?: 'asc' | 'desc' };
    }): Promise<MockIntegration[]> {
      const matches = [...integrations.values()].filter((integration) =>
        integrationMatches(integration, args.where ?? {}),
      );
      if (args.orderBy?.isPrimary === 'desc') {
        matches.sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
      }
      if (args.orderBy?.createdAt === 'desc') {
        matches.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      }
      return matches;
    },
    async count(args: { where: { userId: string; provider: string } }): Promise<number> {
      return [...integrations.values()].filter((integration) =>
        integrationMatches(integration, args.where),
      ).length;
    },
    async create(args: { data: Partial<MockIntegration> }): Promise<MockIntegration> {
      const now = new Date();
      const record: MockIntegration = {
        id: randomUUID(),
        userId: args.data.userId ?? '',
        provider: args.data.provider ?? '',
        accountKey: args.data.accountKey ?? 'default',
        accountName: args.data.accountName ?? null,
        externalId: args.data.externalId ?? null,
        accessToken: args.data.accessToken ?? '',
        refreshToken: args.data.refreshToken ?? null,
        tokenExpiresAt: args.data.tokenExpiresAt ?? null,
        scopes: args.data.scopes ?? null,
        metadata: args.data.metadata ?? null,
        isPrimary: args.data.isPrimary ?? false,
        refreshTokenHash: args.data.refreshTokenHash ?? null,
        lastRefreshedAt: args.data.lastRefreshedAt ?? null,
        refreshCount: args.data.refreshCount ?? 0,
        revokedAt: args.data.revokedAt ?? null,
        revokedReason: args.data.revokedReason ?? null,
        createdAt: now,
        updatedAt: now,
      };
      integrations.set(`${record.userId}:${record.provider}:${record.accountKey}`, record);
      return record;
    },
    async update(args: {
      where: { id: string };
      data: Partial<MockIntegration>;
    }): Promise<MockIntegration> {
      for (const [key, integration] of integrations) {
        if (integration.id === args.where.id) {
          const updated = { ...integration, ...args.data, updatedAt: new Date() };
          integrations.set(key, updated);
          return updated;
        }
      }
      throw new Error('Integration not found');
    },
    async updateMany(args: {
      where: { userId: string; provider: string };
      data: Partial<MockIntegration>;
    }): Promise<{ count: number }> {
      let count = 0;
      for (const [key, integration] of integrations) {
        if (integrationMatches(integration, args.where)) {
          integrations.set(key, { ...integration, ...args.data, updatedAt: new Date() });
          count += 1;
        }
      }
      return { count };
    },
    async delete(args: { where: { id: string } }): Promise<MockIntegration> {
      for (const [key, integration] of integrations) {
        if (integration.id === args.where.id) {
          integrations.delete(key);
          integrationStatuses.delete(integration.id);
          permissionSets.delete(integration.id);
          for (const [syncKey, sync] of syncHistory) {
            if (sync.integrationId === integration.id) {
              syncHistory.delete(syncKey);
            }
          }
          return integration;
        }
      }
      throw new Error('Integration not found');
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
          for (const [statusKey, status] of integrationStatuses) {
            if (status.integrationId === integration.id) {
              integrationStatuses.delete(statusKey);
            }
          }
          for (const [setKey, set] of permissionSets) {
            if (set.integrationId === integration.id) {
              permissionSets.delete(setKey);
            }
          }
          for (const [syncKey, sync] of syncHistory) {
            if (sync.integrationId === integration.id) {
              syncHistory.delete(syncKey);
            }
          }
          count += 1;
        }
      }
      return { count };
    },
  };

  const integrationStatusModel = {
    async findUnique(args: {
      where: { integrationId: string };
    }): Promise<MockIntegrationStatus | null> {
      return integrationStatuses.get(args.where.integrationId) ?? null;
    },
    async upsert(args: {
      where: { integrationId: string };
      create: Partial<MockIntegrationStatus>;
      update: Partial<MockIntegrationStatus>;
    }): Promise<MockIntegrationStatus> {
      const now = new Date();
      const existing = integrationStatuses.get(args.where.integrationId);
      const record: MockIntegrationStatus = existing
        ? { ...existing, ...args.update, updatedAt: now }
        : {
            id: randomUUID(),
            integrationId: args.where.integrationId,
            status: args.create.status ?? 'connected',
            ok: args.create.ok ?? true,
            latencyMs: args.create.latencyMs ?? null,
            lastMessage: args.create.lastMessage ?? null,
            lastHealthCheckAt: args.create.lastHealthCheckAt ?? now,
            lastSuccessAt: args.create.lastSuccessAt ?? null,
            updatedAt: now,
          };
      integrationStatuses.set(record.integrationId, record);
      return record;
    },
  };

  const permissionSetModel = {
    async findUnique(args: {
      where: { integrationId: string };
    }): Promise<MockPermissionSet | null> {
      return permissionSets.get(args.where.integrationId) ?? null;
    },
    async upsert(args: {
      where: { integrationId: string };
      create: Partial<MockPermissionSet>;
      update: Partial<MockPermissionSet>;
    }): Promise<MockPermissionSet> {
      const now = new Date();
      const existing = permissionSets.get(args.where.integrationId);
      const record: MockPermissionSet = existing
        ? { ...existing, ...args.update, updatedAt: now }
        : {
            id: randomUUID(),
            integrationId: args.where.integrationId,
            scopes: args.create.scopes ?? [],
            permissionIds: args.create.permissionIds ?? [],
            grantedAt: args.create.grantedAt ?? now,
            updatedAt: now,
          };
      permissionSets.set(record.integrationId, record);
      return record;
    },
  };

  const syncHistoryModel = {
    async create(args: { data: Partial<MockSyncRecord> }): Promise<MockSyncRecord> {
      const now = new Date();
      const record: MockSyncRecord = {
        id: randomUUID(),
        integrationId: args.data.integrationId ?? '',
        kind: args.data.kind ?? 'health',
        status: (args.data.status ?? 'RUNNING') as MockSyncRecord['status'],
        startedAt: args.data.startedAt ?? now,
        finishedAt: args.data.finishedAt ?? null,
        itemCount: args.data.itemCount ?? null,
        error: args.data.error ?? null,
        detail: args.data.detail ?? null,
        createdAt: now,
      };
      syncHistory.set(record.id, record);
      return record;
    },
    async update(args: {
      where: { id: string };
      data: Partial<MockSyncRecord>;
    }): Promise<MockSyncRecord> {
      const record = syncHistory.get(args.where.id);
      if (!record) {
        throw new Error('Sync record not found');
      }
      const updated = { ...record, ...args.data };
      syncHistory.set(updated.id, updated);
      return updated;
    },
    async findMany(args: {
      where: {
        integration?: { userId?: string; provider?: string };
      };
      orderBy?: { createdAt?: 'asc' | 'desc' };
      take?: number;
    }): Promise<MockSyncRecord[]> {
      let list = [...syncHistory.values()];
      if (args.where.integration) {
        const targetIds = new Set(
          [...integrations.values()]
            .filter(
              (integration) =>
                (args.where.integration?.userId === undefined ||
                  integration.userId === args.where.integration.userId) &&
                (args.where.integration?.provider === undefined ||
                  integration.provider === args.where.integration.provider),
            )
            .map((integration) => integration.id),
        );
        list = list.filter((record) => targetIds.has(record.integrationId));
      }
      if (args.orderBy?.createdAt === 'desc') {
        list.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      }
      if (args.take !== undefined) {
        list = list.slice(0, args.take);
      }
      return list;
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
      integrationStatus: integrationStatusModel,
      permissionSet: permissionSetModel,
      syncHistory: syncHistoryModel,
      $transaction: async <T>(
        operations: readonly (Promise<T> | (() => Promise<T>))[],
      ): Promise<T[]> => {
        const results: T[] = [];
        for (const operation of operations) {
          results.push(await (typeof operation === 'function' ? operation() : operation));
        }
        return results;
      },
      $disconnect: async (): Promise<void> => undefined,
    },
    resetDb: (): void => {
      users.clear();
      sessions.clear();
      integrations.clear();
      integrationStatuses.clear();
      permissionSets.clear();
      syncHistory.clear();
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
    expect(providers).toHaveLength(12);
    const github = providers.find((p) => p.id === 'github');
    expect(github?.connected).toBe(true);
    expect(github?.accountName).toBe('octocat');
    const calendar = providers.find((p) => p.id === 'google-calendar');
    expect(calendar?.connected).toBe(false);
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
    const { signOAuthState } = await import('../src/integrations/oauth-engine.js');
    const state = await signOAuthState({
      sub: userId,
      provider: 'github',
      codeVerifier: 'test-verifier',
      codeChallenge: 'test-challenge',
      redirectUri: 'http://localhost:3000/api/v1/integrations/github/callback',
    });

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

  it('reports status, scopes, and permissions in the integration list', async () => {
    const { authorization, userId } = await authSession('owner@example.com');
    const { upsertIntegration } = await import('../src/integrations/store.js');
    await upsertIntegration(userId, {
      provider: 'github',
      accessToken: 'gh_token',
      accountName: 'octocat',
      scopes: 'repo read:user',
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/integrations',
      headers: { authorization },
    });
    const body = JSON.parse(response.body);
    const github = body.integrations.find((p: { id: string }) => p.id === 'github');
    expect(github.status).toBe('connected');
    expect(github.scopes).toBe('repo read:user');
    expect(github.capabilities).toContain('github:repos');
    expect(github).toHaveProperty('connectedAt');
    expect(github).toHaveProperty('tokenExpiresAt');
    expect(Array.isArray(github.permissions)).toBe(true);
    const repos = github.permissions.find(
      (permission: { id: string }) => permission.id === 'github.repos',
    );
    expect(repos.enabled).toBe(true);
    expect(repos.capability).toBe('github:repos');
  });

  it('tests a connection for a connected provider', async () => {
    const { authorization, userId } = await authSession('owner@example.com');
    const { upsertIntegration } = await import('../src/integrations/store.js');
    await upsertIntegration(userId, {
      provider: 'github',
      accessToken: 'gh_token',
      accountName: 'octocat',
    });

    const fetchMock = vi.fn(async (input: string) => {
      const url = String(input);
      if (url.includes('api.github.com/user')) {
        return new Response(JSON.stringify({ login: 'octocat' }), { status: 200 });
      }
      return new Response('Not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/integrations/github/test',
      headers: { authorization },
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.ok).toBe(true);
    expect(body.accountName).toBe('octocat');
    expect(typeof body.latencyMs).toBe('number');
  });

  it('reports a failed test when not connected', async () => {
    const { authorization } = await authSession('owner@example.com');
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/integrations/github/test',
      headers: { authorization },
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.ok).toBe(false);
    expect(body.message).toContain('has not connected');
  });

  it('returns 404 when testing an unknown provider', async () => {
    const { authorization } = await authSession('owner@example.com');
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/integrations/unknown-provider/test',
      headers: { authorization },
    });
    expect(response.statusCode).toBe(404);
  });

  it('lists permission definitions for a provider', async () => {
    const { authorization } = await authSession('owner@example.com');
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/integrations/github/permissions',
      headers: { authorization },
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.provider).toBe('github');
    expect(body.connected).toBe(false);
    const repos = body.permissions.find(
      (permission: { id: string }) => permission.id === 'github.repos',
    );
    expect(repos).toBeDefined();
    expect(repos.label).toBe('Repositories');
  });

  it('lists every provider and permission in the permission center', async () => {
    const { authorization, userId } = await authSession('owner@example.com');
    const { upsertIntegration } = await import('../src/integrations/store.js');
    await upsertIntegration(userId, {
      provider: 'github',
      accessToken: 'gh_token',
      accountName: 'octocat',
      scopes: 'repo read:user',
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/integrations/permissions',
      headers: { authorization },
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(Array.isArray(body.providers)).toBe(true);
    const github = body.providers.find((p: { id: string }) => p.id === 'github');
    expect(github).toBeDefined();
    expect(github.connected).toBe(true);
    expect(github.accountName).toBe('octocat');
    expect(github.scopes).toBe('repo read:user');
    const repos = github.permissions.find((p: { id: string }) => p.id === 'github.repos');
    expect(repos.granted).toBe(true);
    expect(repos.enabled).toBe(true);
    expect(repos.capability).toBe('github:repos');
    const discord = body.providers.find((p: { id: string }) => p.id === 'discord');
    expect(discord.connected).toBe(false);
    expect(discord.permissions[0].granted).toBe(false);
    expect(discord.permissions[0].enabled).toBe(false);
  });

  it('updates the enabled permission set for a connected provider', async () => {
    const { authorization, userId } = await authSession('owner@example.com');
    const { upsertIntegration } = await import('../src/integrations/store.js');
    await upsertIntegration(userId, {
      provider: 'github',
      accessToken: 'gh_token',
      accountName: 'octocat',
      scopes: 'repo read:user',
    });

    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/integrations/github/permissions',
      headers: { authorization },
      payload: { permissions: ['github.repos', 'github.issues'] },
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.ok).toBe(true);
    const repos = body.permissions.permissions.find((p: { id: string }) => p.id === 'github.repos');
    expect(repos.enabled).toBe(true);
    const pulls = body.permissions.permissions.find((p: { id: string }) => p.id === 'github.pulls');
    expect(pulls.enabled).toBe(false);

    const listResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/integrations/permissions',
      headers: { authorization },
    });
    const listed = JSON.parse(listResponse.body);
    const github = listed.providers.find((p: { id: string }) => p.id === 'github');
    const listedRepos = github.permissions.find((p: { id: string }) => p.id === 'github.repos');
    const listedPulls = github.permissions.find((p: { id: string }) => p.id === 'github.pulls');
    expect(listedRepos.enabled).toBe(true);
    expect(listedPulls.enabled).toBe(false);
  });

  it('returns 404 when updating permissions for an unconnected or unknown provider', async () => {
    const { authorization } = await authSession('owner@example.com');
    const unknown = await app.inject({
      method: 'PUT',
      url: '/api/v1/integrations/unknown-provider/permissions',
      headers: { authorization },
      payload: { permissions: ['x'] },
    });
    expect(unknown.statusCode).toBe(404);

    const notConnected = await app.inject({
      method: 'PUT',
      url: '/api/v1/integrations/github/permissions',
      headers: { authorization },
      payload: { permissions: ['github.repos'] },
    });
    expect(notConnected.statusCode).toBe(404);
  });

  it('emits lifecycle events on connect and disconnect', async () => {
    const { onIntegrationEvent, clearIntegrationEventHandlers } =
      await import('../src/integrations/events.js');
    clearIntegrationEventHandlers();
    const seen: string[] = [];
    onIntegrationEvent((event) => seen.push(event.type));

    const { authorization } = await authSession('owner@example.com');
    const connect = await app.inject({
      method: 'POST',
      url: '/api/v1/integrations/discord',
      headers: { authorization },
      payload: { webhookUrl: 'https://discord.com/api/webhooks/123/abc' },
    });
    expect(connect.statusCode).toBe(201);

    const disconnect = await app.inject({
      method: 'DELETE',
      url: '/api/v1/integrations/discord',
      headers: { authorization },
    });
    expect(disconnect.statusCode).toBe(204);

    expect(seen).toContain('connected');
    expect(seen).toContain('disconnected');
    clearIntegrationEventHandlers();
  });

  it('supports multiple accounts per provider and promotes a primary', async () => {
    const { authorization, userId } = await authSession('multi@example.com');
    const { upsertIntegration } = await import('../src/integrations/store.js');
    await upsertIntegration(userId, {
      provider: 'github',
      accessToken: 'gh_personal',
      accountKey: 'personal',
      accountName: 'octocat',
      scopes: 'repo read:user',
    });
    await upsertIntegration(userId, {
      provider: 'github',
      accessToken: 'gh_work',
      accountKey: 'work',
      accountName: 'work-org',
      scopes: 'repo read:user',
    });

    const accounts = await app.inject({
      method: 'GET',
      url: '/api/v1/integrations/github/accounts',
      headers: { authorization },
    });
    expect(accounts.statusCode).toBe(200);
    const body = JSON.parse(accounts.body);
    expect(body.count).toBe(2);
    const personal = body.accounts.find(
      (account: { accountKey: string }) => account.accountKey === 'personal',
    );
    const work = body.accounts.find(
      (account: { accountKey: string }) => account.accountKey === 'work',
    );
    expect(personal.isPrimary).toBe(true);
    expect(work.isPrimary).toBe(false);

    const promote = await app.inject({
      method: 'POST',
      url: `/api/v1/integrations/github/accounts/${work.id}/primary`,
      headers: { authorization },
    });
    expect(promote.statusCode).toBe(200);

    const afterBody = JSON.parse(
      (
        await app.inject({
          method: 'GET',
          url: '/api/v1/integrations/github/accounts',
          headers: { authorization },
        })
      ).body,
    );
    expect(
      afterBody.accounts.find((account: { accountKey: string }) => account.accountKey === 'work')
        .isPrimary,
    ).toBe(true);
    expect(
      afterBody.accounts.find(
        (account: { accountKey: string }) => account.accountKey === 'personal',
      ).isPrimary,
    ).toBe(false);

    const list = JSON.parse(
      (
        await app.inject({
          method: 'GET',
          url: '/api/v1/integrations',
          headers: { authorization },
        })
      ).body,
    );
    const github = list.integrations.find((item: { id: string }) => item.id === 'github');
    expect(github.accountKey).toBe('work');
  });

  it('returns 404 when promoting an unknown account', async () => {
    const { authorization } = await authSession('no-account@example.com');
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/integrations/github/accounts/not-an-account/primary',
      headers: { authorization },
    });
    expect(response.statusCode).toBe(404);
  });

  it('stores an OAuth connection under the requested account key', async () => {
    const { authorization, userId } = await authSession('oauth-key@example.com');
    const { signOAuthState } = await import('../src/integrations/oauth-engine.js');
    const state = await signOAuthState({
      sub: userId,
      provider: 'github',
      accountKey: 'work',
      codeVerifier: 'test-verifier',
      codeChallenge: 'test-challenge',
      redirectUri: 'http://localhost:3000/api/v1/integrations/github/callback',
    });

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

    const accounts = JSON.parse(
      (
        await app.inject({
          method: 'GET',
          url: '/api/v1/integrations/github/accounts',
          headers: { authorization },
        })
      ).body,
    );
    expect(accounts.count).toBe(1);
    expect(accounts.accounts[0].accountKey).toBe('work');
  });

  it('exposes persisted health status and permission set', async () => {
    const { authorization, userId } = await authSession('status@example.com');
    const { upsertIntegration } = await import('../src/integrations/store.js');
    await upsertIntegration(userId, {
      provider: 'github',
      accessToken: 'gh_token',
      accountName: 'octocat',
      scopes: 'repo read:user',
    });

    const fetchMock = vi.fn(async (input: string) => {
      const url = String(input);
      if (url.includes('api.github.com/user')) {
        return new Response(JSON.stringify({ login: 'octocat' }), { status: 200 });
      }
      return new Response('Not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const test = await app.inject({
      method: 'POST',
      url: '/api/v1/integrations/github/test',
      headers: { authorization },
    });
    expect(test.statusCode).toBe(200);

    const status = await app.inject({
      method: 'GET',
      url: '/api/v1/integrations/github/status',
      headers: { authorization },
    });
    expect(status.statusCode).toBe(200);
    const body = JSON.parse(status.body);
    expect(body.connected).toBe(true);
    expect(body.status).toBe('connected');
    expect(body.health).toBeTruthy();
    expect(body.health.ok).toBe(true);
    expect(body.permissions).toBeTruthy();
    expect(body.permissions.permissionIds).toContain('github.repos');
    expect(body.permissions.scopes).toContain('repo');
  });

  it('records sync history for connection tests', async () => {
    const { authorization, userId } = await authSession('sync@example.com');
    const { upsertIntegration } = await import('../src/integrations/store.js');
    await upsertIntegration(userId, {
      provider: 'github',
      accessToken: 'gh_token',
      accountName: 'octocat',
    });

    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ login: 'octocat' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await app.inject({
      method: 'POST',
      url: '/api/v1/integrations/github/test',
      headers: { authorization },
    });

    const history = await app.inject({
      method: 'GET',
      url: '/api/v1/integrations/github/sync-history',
      headers: { authorization },
    });
    expect(history.statusCode).toBe(200);
    const body = JSON.parse(history.body);
    expect(body.provider).toBe('github');
    expect(body.count).toBe(1);
    expect(body.history[0].status).toBe('SUCCESS');
  });

  it('records a failed sync for a failing health check', async () => {
    const { authorization, userId } = await authSession('sync-fail@example.com');
    const { upsertIntegration } = await import('../src/integrations/store.js');
    await upsertIntegration(userId, {
      provider: 'github',
      accessToken: 'gh_token',
      accountName: 'octocat',
    });

    const fetchMock = vi.fn(async () => new Response('Not found', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);

    const test = await app.inject({
      method: 'POST',
      url: '/api/v1/integrations/github/test',
      headers: { authorization },
    });
    expect(JSON.parse(test.body).ok).toBe(false);

    const history = JSON.parse(
      (
        await app.inject({
          method: 'GET',
          url: '/api/v1/integrations/github/sync-history',
          headers: { authorization },
        })
      ).body,
    );
    expect(history.count).toBe(1);
    expect(history.history[0].status).toBe('FAILED');
  });

  it('returns a reconnect URL with PKCE parameters', async () => {
    const { authorization } = await authSession('reconnect@example.com');
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/integrations/github/reconnect',
      headers: { authorization },
      payload: { accountKey: 'work', scopes: 'repo' },
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.ok).toBe(true);
    expect(body.provider).toBe('github');
    expect(body.accountKey).toBe('work');
    const url = new URL(body.url);
    expect(url.host).toBe('github.com');
    expect(url.searchParams.get('code_challenge')).toBeTruthy();
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('state')).toBeTruthy();
    expect(url.searchParams.get('scope')).toBe('repo');
  });

  it('rotates tokens on a manual refresh', async () => {
    const { authorization, userId } = await authSession('refresh@example.com');
    const { upsertIntegration } = await import('../src/integrations/store.js');
    await upsertIntegration(userId, {
      provider: 'github',
      accessToken: 'gh_old',
      refreshToken: 'gh_refresh_old',
      accountName: 'octocat',
      tokenExpiresAt: new Date(Date.now() - 1000),
      scopes: 'repo read:user',
    });

    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            access_token: 'gh_new',
            refresh_token: 'gh_refresh_new',
            expires_in: 3600,
            scope: 'repo',
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/integrations/github/refresh',
      headers: { authorization },
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.ok).toBe(true);
    expect(body.status).toBe('connected');
    expect(body.refreshCount).toBe(1);
    expect(body.lastRefreshedAt).toBeTruthy();
    expect(body.tokenExpiresAt).toBeTruthy();
  });

  it('deletes a single account and promotes a successor primary', async () => {
    const { authorization, userId } = await authSession('delete-acct@example.com');
    const { upsertIntegration } = await import('../src/integrations/store.js');
    await upsertIntegration(userId, {
      provider: 'github',
      accessToken: 'gh_personal',
      accountKey: 'personal',
      accountName: 'octocat',
    });
    await upsertIntegration(userId, {
      provider: 'github',
      accessToken: 'gh_work',
      accountKey: 'work',
      accountName: 'work-org',
    });

    const accounts = JSON.parse(
      (
        await app.inject({
          method: 'GET',
          url: '/api/v1/integrations/github/accounts',
          headers: { authorization },
        })
      ).body,
    );
    const personal = accounts.accounts.find(
      (account: { accountKey: string }) => account.accountKey === 'personal',
    );
    const deleteResponse = await app.inject({
      method: 'DELETE',
      url: `/api/v1/integrations/github/accounts/${personal.id}`,
      headers: { authorization },
    });
    expect(deleteResponse.statusCode).toBe(204);

    const after = JSON.parse(
      (
        await app.inject({
          method: 'GET',
          url: '/api/v1/integrations/github/accounts',
          headers: { authorization },
        })
      ).body,
    );
    expect(after.count).toBe(1);
    expect(after.accounts[0].accountKey).toBe('work');
    expect(after.accounts[0].isPrimary).toBe(true);
  });

  it('exposes a revoked account in the accounts list', async () => {
    const { authorization, userId } = await authSession('revoked@example.com');
    const { getIntegration, revokeIntegration, upsertIntegration } =
      await import('../src/integrations/store.js');
    await upsertIntegration(userId, {
      provider: 'github',
      accessToken: 'gh',
      accountName: 'octocat',
    });
    const record = await getIntegration(userId, 'github');
    if (record) {
      await revokeIntegration(record.id, 'refresh_token_reuse');
    }

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/integrations/github/accounts',
      headers: { authorization },
    });
    const body = JSON.parse(response.body);
    expect(body.accounts[0].status).toBe('revoked');
    expect(body.accounts[0].revokedReason).toBe('refresh_token_reuse');
  });

  it('requires authentication on the hub', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/integrations/hub' });
    expect(response.statusCode).toBe(401);
  });

  it('aggregates health, last sync, permissions, and account count in the hub', async () => {
    const { authorization, userId } = await authSession('hub@example.com');
    const { upsertIntegration } = await import('../src/integrations/store.js');
    await upsertIntegration(userId, {
      provider: 'github',
      accessToken: 'gh_token',
      accountName: 'octocat',
      scopes: 'repo read:user',
    });

    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ login: 'octocat' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await app.inject({
      method: 'POST',
      url: '/api/v1/integrations/github/test',
      headers: { authorization },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/integrations/hub',
      headers: { authorization },
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.providers).toHaveLength(12);

    const github = body.providers.find((p: { id: string }) => p.id === 'github');
    expect(github.connected).toBe(true);
    expect(github.status).toBe('connected');
    expect(github.accountName).toBe('octocat');
    expect(github.health).toBeTruthy();
    expect(github.health.ok).toBe(true);
    expect(typeof github.health.latencyMs).toBe('number');
    expect(github.lastSync).toBeTruthy();
    expect(github.lastSync.status).toBe('SUCCESS');
    expect(github.accountCount).toBe(1);
    const repos = github.permissions.find(
      (permission: { id: string }) => permission.id === 'github.repos',
    );
    expect(repos.enabled).toBe(true);

    const slack = body.providers.find((p: { id: string }) => p.id === 'slack');
    expect(slack.connected).toBe(false);
    expect(slack.health).toBeNull();
    expect(slack.lastSync).toBeNull();
    expect(slack.accountCount).toBe(0);
  });
});

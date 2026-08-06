import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
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
const STATE_FILE = path.join(tmpdir(), `bro-marketplace-test-${process.pid}.json`);
process.env.MARKETPLACE_STATE_FILE = STATE_FILE;

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
  code: string | null;
  apiStatus: string | null;
  quota: unknown;
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
            code: args.create.code ?? null,
            apiStatus: args.create.apiStatus ?? null,
            quota: args.create.quota ?? null,
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

describe('marketplace', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { buildApp } = await import('../src/app.js');
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await rm(STATE_FILE, { force: true }).catch(() => undefined);
  });

  beforeEach(async () => {
    resetDb();
    vi.restoreAllMocks();
    const { resetMarketplaceState } = await import('../src/integrations/marketplace.js');
    resetMarketplaceState();
    await rm(STATE_FILE, { force: true }).catch(() => undefined);
  });

  async function authSession(email: string): Promise<{ authorization: string; userId: string }> {
    const { token, userId } = await registerAndLogin(email);
    return { authorization: `Bearer ${token}`, userId };
  }

  it('lists the marketplace catalog in three buckets', async () => {
    const { authorization } = await authSession('owner@example.com');

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/integrations/marketplace',
      headers: { authorization },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.installed.map((item: { id: string }) => item.id).sort()).toEqual(
      ['drive', 'github', 'google', 'slack', 'discord', 'notion', 'whatsapp'].sort(),
    );
    expect(body.available.map((item: { id: string }) => item.id).sort()).toEqual(
      ['dropbox', 'zoom', 'clickup', 'stripe', 'openai', 'nvidia', 'gemini', 'anthropic'].sort(),
    );
    expect(body.future.map((item: { id: string }) => item.id)).toHaveLength(10);
  });

  it('exposes token fields and auth type on marketplace views', async () => {
    const { authorization } = await authSession('owner@example.com');

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/integrations/marketplace',
      headers: { authorization },
    });

    const body = response.json();
    const openai = body.available.find((item: { id: string }) => item.id === 'openai');
    expect(openai.authType).toBe('token');
    expect(openai.fields.map((field: { name: string }) => field.name)).toEqual(['apiKey']);
    const github = body.installed.find((item: { id: string }) => item.id === 'github');
    expect(github.authType).toBe('oauth');
    expect(github.requiredEnv).toContain('GITHUB_CLIENT_ID');
  });

  it('installs an available provider and registers its adapter', async () => {
    const { authorization } = await authSession('owner@example.com');

    const install = await app.inject({
      method: 'POST',
      url: '/api/v1/integrations/marketplace/openai/install',
      headers: { authorization },
    });
    expect(install.statusCode).toBe(200);
    expect(install.json().item.installed).toBe(true);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/integrations/marketplace',
      headers: { authorization },
    });
    const body = response.json();
    expect(body.installed.some((item: { id: string }) => item.id === 'openai')).toBe(true);
    expect(body.available.some((item: { id: string }) => item.id === 'openai')).toBe(false);

    const hub = await app.inject({
      method: 'GET',
      url: '/api/v1/integrations/hub',
      headers: { authorization },
    });
    const hubBody = hub.json();
    expect(hubBody.providers.some((provider: { id: string }) => provider.id === 'openai')).toBe(
      true,
    );
  });

  it('uninstalls a provider and moves it back to available', async () => {
    const { authorization } = await authSession('owner@example.com');

    await app.inject({
      method: 'POST',
      url: '/api/v1/integrations/marketplace/openai/install',
      headers: { authorization },
    });
    const uninstall = await app.inject({
      method: 'DELETE',
      url: '/api/v1/integrations/marketplace/openai',
      headers: { authorization },
    });
    expect(uninstall.statusCode).toBe(200);
    expect(uninstall.json().item.installed).toBe(false);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/integrations/marketplace',
      headers: { authorization },
    });
    const body = response.json();
    expect(body.available.some((item: { id: string }) => item.id === 'openai')).toBe(true);
    expect(body.installed.some((item: { id: string }) => item.id === 'openai')).toBe(false);
  });

  it('disables and re-enables a bundled provider', async () => {
    const { authorization } = await authSession('owner@example.com');

    const uninstall = await app.inject({
      method: 'DELETE',
      url: '/api/v1/integrations/marketplace/github',
      headers: { authorization },
    });
    expect(uninstall.statusCode).toBe(200);
    expect(uninstall.json().item.installed).toBe(false);

    const reinstall = await app.inject({
      method: 'POST',
      url: '/api/v1/integrations/marketplace/github/install',
      headers: { authorization },
    });
    expect(reinstall.statusCode).toBe(200);
    expect(reinstall.json().item.installed).toBe(true);
  });

  it('rejects installing a roadmap provider with 409', async () => {
    const { authorization } = await authSession('owner@example.com');

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/integrations/marketplace/trello/install',
      headers: { authorization },
    });
    expect(response.statusCode).toBe(409);
  });

  it('rejects unknown marketplace items with 404', async () => {
    const { authorization } = await authSession('owner@example.com');

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/integrations/marketplace/unknown/install',
      headers: { authorization },
    });
    expect(response.statusCode).toBe(404);
  });

  it('reports the update status for an installed provider', async () => {
    const { authorization } = await authSession('owner@example.com');

    await app.inject({
      method: 'POST',
      url: '/api/v1/integrations/marketplace/openai/install',
      headers: { authorization },
    });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/integrations/marketplace/openai/update',
      headers: { authorization },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().updated).toBe(false);
  });

  it('connects a token provider through the generic token route', async () => {
    const { authorization, userId } = await authSession('owner@example.com');

    await app.inject({
      method: 'POST',
      url: '/api/v1/integrations/marketplace/openai/install',
      headers: { authorization },
    });
    const save = await app.inject({
      method: 'POST',
      url: '/api/v1/integrations/openai',
      headers: { authorization },
      payload: { apiKey: 'sk-test-123', accountName: 'Workspace' },
    });
    expect(save.statusCode).toBe(201);
    expect(save.json().accountName).toBe('Workspace');

    const marketplace = await app.inject({
      method: 'GET',
      url: '/api/v1/integrations/marketplace',
      headers: { authorization },
    });
    const openai = marketplace
      .json()
      .installed.find((item: { id: string }) => item.id === 'openai');
    expect(openai.connected).toBe(true);
    expect(openai.accountName).toBe('Workspace');

    const { getIntegration } = await import('../src/integrations/store.js');
    const record = await getIntegration(userId, 'openai');
    expect(record?.metadata).toEqual({ apiKey: 'sk-test-123' });
  });

  it('rejects saving a token without its required fields', async () => {
    const { authorization } = await authSession('owner@example.com');

    await app.inject({
      method: 'POST',
      url: '/api/v1/integrations/marketplace/openai/install',
      headers: { authorization },
    });
    const save = await app.inject({
      method: 'POST',
      url: '/api/v1/integrations/openai',
      headers: { authorization },
      payload: {},
    });
    expect(save.statusCode).toBe(400);
  });

  it('requires authentication for marketplace endpoints', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/integrations/marketplace',
    });
    expect(response.statusCode).toBe(401);
  });
});

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

type MockUser = {
  id: string;
  email: string;
  role: 'USER' | 'ADMIN';
  isActive: boolean;
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
  refreshTokenHash: string | null;
  tokenExpiresAt: Date | null;
  scopes: string | null;
  metadata: Record<string, unknown> | null;
  isPrimary: boolean;
  lastRefreshedAt: Date | null;
  refreshCount: number;
  revokedAt: Date | null;
  revokedReason: string | null;
  createdAt: Date;
};

const { mockPrisma, resetDb, registerAndLogin, seedIntegration, getUpsertedPermissionSets } =
  vi.hoisted(() => {
    process.env.DATABASE_URL = '';
    process.env.REDIS_URL = '';
    process.env.JWT_SECRET = 'grant-access-secret';
    process.env.JWT_REFRESH_SECRET = 'grant-refresh-secret';
    process.env.JWT_EXPIRES_IN = '15m';
    process.env.JWT_REFRESH_EXPIRES_IN = '7d';

    const users = new Map<string, MockUser>();
    const integrations = new Map<string, MockIntegration>();
    const upserts: Array<{ integrationId: string; permissionIds: string[] }> = [];

    const userModel = {
      async findUnique(args: {
        where: { id?: string; email?: string };
        select?: unknown;
      }): Promise<MockUser | null> {
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
    };

    const integrationModel = {
      async findFirst(args: {
        where?: { userId?: string; provider?: string; isPrimary?: boolean };
        orderBy?: unknown;
      }): Promise<MockIntegration | null> {
        let matches: MockIntegration[] = [...integrations.values()];
        const where = args.where ?? {};
        if (where.userId !== undefined) {
          matches = matches.filter((record) => record.userId === where.userId);
        }
        if (where.provider !== undefined) {
          matches = matches.filter((record) => record.provider === where.provider);
        }
        if (where.isPrimary === true) {
          matches = matches.filter((record) => record.isPrimary);
        }
        return matches[0] ?? null;
      },
    };

    const permissionSetModel = {
      async findUnique(): Promise<null> {
        return null;
      },
      async upsert(args: {
        where: { integrationId: string };
        update: { permissionIds: unknown };
        create: { permissionIds: unknown };
      }): Promise<{ integrationId: string; permissionIds: unknown }> {
        const permissionIds = (args.update.permissionIds ?? args.create.permissionIds) as string[];
        upserts.push({ integrationId: args.where.integrationId, permissionIds });
        return { integrationId: args.where.integrationId, permissionIds };
      },
    };

    async function registerAndLogin(
      email: string,
      role: 'USER' | 'ADMIN' = 'USER',
    ): Promise<{ token: string; user: MockUser }> {
      const user: MockUser = {
        id: randomUUID(),
        email,
        role,
        isActive: true,
      };
      users.set(user.id, user);
      const { signAccessToken } = await import('../../src/lib/jwt.js');
      return { token: await signAccessToken(user.id, user.role), user };
    }

    function seedIntegration(userId: string, provider: string): MockIntegration {
      const record: MockIntegration = {
        id: randomUUID(),
        userId,
        provider,
        accountKey: 'default',
        accountName: `${provider} account`,
        externalId: null,
        accessToken: 'test-token',
        refreshToken: null,
        refreshTokenHash: null,
        tokenExpiresAt: null,
        scopes: '',
        metadata: {},
        isPrimary: true,
        lastRefreshedAt: null,
        refreshCount: 0,
        revokedAt: null,
        revokedReason: null,
        createdAt: new Date(),
      };
      integrations.set(record.id, record);
      return record;
    }

    return {
      mockPrisma: {
        user: userModel,
        integration: integrationModel,
        permissionSet: permissionSetModel,
        $queryRaw: async (): Promise<Array<{ '?column?': number }>> => [{ '?column?': 1 }],
        $disconnect: async (): Promise<void> => undefined,
      },
      resetDb: (): void => {
        users.clear();
        integrations.clear();
        upserts.length = 0;
      },
      registerAndLogin,
      seedIntegration,
      getUpsertedPermissionSets: (): typeof upserts => upserts,
    };
  });

vi.mock('../../src/lib/prisma.js', () => ({ prisma: mockPrisma }));

describe('regression: admin grant-all permissions', () => {
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
  });

  it('rejects non-admin callers with 403', async () => {
    const { token } = await registerAndLogin('plain-user@example.com');

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/permissions/grant-all',
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });

    expect(response.statusCode).toBe(403);
  });

  it('enables every permission id for a target user across connected providers', async () => {
    const { token } = await registerAndLogin('admin@example.com', 'ADMIN');
    const { user: target } = await registerAndLogin('target@example.com');
    seedIntegration(target.id, 'notion');

    const { listProviders } = await import('../../src/integrations/providers.js');
    const notion = listProviders().find((provider) => provider.id === 'notion');
    expect(notion).toBeDefined();
    const expectedIds = notion?.permissions.map((permission) => permission.id) ?? [];

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/permissions/grant-all',
      headers: { authorization: `Bearer ${token}` },
      payload: { email: 'target@example.com' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.user.email).toBe('target@example.com');
    expect(body.providersUpdated).toContain('notion');
    expect(body.permissionsGranted).toBe(expectedIds.length);
    expect(getUpsertedPermissionSets()).toEqual([
      { integrationId: expect.any(String), permissionIds: expect.arrayContaining(expectedIds) },
    ]);
  });

  it('defaults to the requesting admin when no email is provided', async () => {
    const { token, user } = await registerAndLogin('self-admin@example.com', 'ADMIN');
    seedIntegration(user.id, 'notion');

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/permissions/grant-all',
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).user.email).toBe('self-admin@example.com');
    expect(JSON.parse(response.body).providersUpdated.length).toBeGreaterThan(0);
  });

  it('skips providers the target user has not connected', async () => {
    const { token } = await registerAndLogin('admin@example.com', 'ADMIN');
    await registerAndLogin('target@example.com');

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/permissions/grant-all',
      headers: { authorization: `Bearer ${token}` },
      payload: { email: 'target@example.com' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.providersUpdated).toEqual([]);
    expect(body.permissionsGranted).toBe(0);
    expect(getUpsertedPermissionSets()).toEqual([]);
  });

  it('returns 404 for an unknown email', async () => {
    const { token } = await registerAndLogin('admin@example.com', 'ADMIN');

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/permissions/grant-all',
      headers: { authorization: `Bearer ${token}` },
      payload: { email: 'nobody@example.com' },
    });

    expect(response.statusCode).toBe(404);
    expect(JSON.parse(response.body).error?.message).toBe('User not found');
  });

  it('returns 400 for an invalid email', async () => {
    const { token } = await registerAndLogin('admin@example.com', 'ADMIN');

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/permissions/grant-all',
      headers: { authorization: `Bearer ${token}` },
      payload: { email: 'not-an-email' },
    });

    expect(response.statusCode).toBe(400);
  });
});

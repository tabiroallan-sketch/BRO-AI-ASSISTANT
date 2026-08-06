import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

type MockUser = {
  id: string;
  email: string;
  role: 'USER' | 'ADMIN';
  isActive: boolean;
  displayName: string | null;
  avatarUrl: string | null;
  googleId: string | null;
};

const { mockPrisma, resetDb, registerAndLogin, listUsers } = vi.hoisted(() => {
  process.env.DATABASE_URL = '';
  process.env.REDIS_URL = '';
  process.env.JWT_SECRET = 'regression-access-secret';
  process.env.JWT_REFRESH_SECRET = 'regression-refresh-secret';
  process.env.JWT_EXPIRES_IN = '15m';
  process.env.JWT_REFRESH_EXPIRES_IN = '7d';

  const users = new Map<string, MockUser>();

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
    async findMany(): Promise<MockUser[]> {
      return [...users.values()];
    },
    async create(args: { data: Partial<MockUser>; select?: unknown }): Promise<MockUser> {
      const user: MockUser = {
        id: randomUUID(),
        email: args.data.email ?? '',
        role: args.data.role ?? 'USER',
        isActive: true,
        displayName: args.data.displayName ?? null,
        avatarUrl: args.data.avatarUrl ?? null,
        googleId: args.data.googleId ?? null,
      };
      users.set(user.id, user);
      return user;
    },
    async update(args: { where: { id: string }; data: Partial<MockUser> }): Promise<MockUser> {
      const existing = users.get(args.where.id);
      if (!existing) {
        throw new Error('User not found');
      }
      const updated = { ...existing, ...args.data };
      users.set(updated.id, updated);
      return updated;
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
      displayName: null,
      avatarUrl: null,
      googleId: null,
    };
    users.set(user.id, user);
    const { signAccessToken } = await import('../../src/lib/jwt.js');
    return { token: await signAccessToken(user.id, user.role), user };
  }

  return {
    mockPrisma: {
      user: userModel,
      $queryRaw: async (): Promise<Array<{ '?column?': number }>> => [{ '?column?': 1 }],
      $disconnect: async (): Promise<void> => undefined,
    },
    resetDb: (): void => {
      users.clear();
    },
    registerAndLogin,
    listUsers: (): MockUser[] => [...users.values()],
  };
});

vi.mock('../../src/lib/prisma.js', () => ({ prisma: mockPrisma }));

describe('regression: admin user-management guards (Milestone 19 fixes)', () => {
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

  it('blocks an admin from demoting their own account', async () => {
    const { token, user } = await registerAndLogin('self-demote@example.com', 'ADMIN');

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/users/${user.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { role: 'USER' },
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error?.message).toBe('You cannot demote your own account');
    expect(listUsers().find((item) => item.id === user.id)?.role).toBe('ADMIN');
  });

  it('blocks an admin from deactivating their own account', async () => {
    const { token, user } = await registerAndLogin('self-deactivate@example.com', 'ADMIN');

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/users/${user.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { isActive: false },
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error?.message).toBe('You cannot deactivate your own account');
    expect(listUsers().find((item) => item.id === user.id)?.isActive).toBe(true);
  });

  it('returns 404 when updating a user that does not exist', async () => {
    const { token } = await registerAndLogin('admin-missing@example.com', 'ADMIN');
    const missingId = randomUUID();

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/users/${missingId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { role: 'ADMIN' },
    });

    expect(response.statusCode).toBe(404);
    expect(JSON.parse(response.body).error?.message).toBe('User not found');
  });

  it('allows an admin to promote another user', async () => {
    const { token } = await registerAndLogin('admin-promote@example.com', 'ADMIN');
    const { user: other } = await registerAndLogin('promotee@example.com');

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/users/${other.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { role: 'ADMIN' },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).user.role).toBe('ADMIN');
    expect(listUsers().find((item) => item.id === other.id)?.role).toBe('ADMIN');
  });
});

describe('regression: admin audit log limit clamping (Milestone 19 fix)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { buildApp } = await import('../../src/app.js');
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    resetDb();
    const { recordAudit } = await import('../../src/lib/audit.js');
    for (let index = 0; index < 1050; index += 1) {
      recordAudit({ action: 'auth.login', detail: `regression-seed-${index}` });
    }
  });

  async function auditHeaders(): Promise<{ authorization: string }> {
    const { token } = await registerAndLogin(`audit-${randomUUID()}@example.com`, 'ADMIN');
    return { authorization: `Bearer ${token}` };
  }

  it('clamps a requested limit above the maximum to 1000', async () => {
    const headers = await auditHeaders();
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/audit?limit=5000',
      headers,
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).count).toBe(1000);
  });

  it('clamps non-positive limits up to 1', async () => {
    const headers = await auditHeaders();
    for (const limit of ['0', '-5']) {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/audit?limit=${limit}`,
        headers,
      });
      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body).count).toBe(1);
    }
  });

  it('falls back to the default limit for unparsable input', async () => {
    const headers = await auditHeaders();
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/audit?limit=not-a-number',
      headers,
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).count).toBe(200);
  });
});

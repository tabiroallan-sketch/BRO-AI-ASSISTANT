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

const { mockPrisma, resetDb } = vi.hoisted(() => {
  const users = new Map<string, MockUser>();
  const sessions = new Map<string, MockSession>();

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
      return (
        session ?? {
          id: args.where.id,
          userId: '',
          token: '',
          expiresAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        }
      );
    },
    async deleteMany(args: { where: { token: string } }): Promise<{ count: number }> {
      let count = 0;
      for (const [id, session] of sessions) {
        if (session.token === args.where.token) {
          sessions.delete(id);
          count += 1;
        }
      }
      return { count };
    },
  };

  return {
    mockPrisma: {
      user: userModel,
      session: sessionModel,
      $disconnect: async (): Promise<void> => undefined,
    },
    resetDb: (): void => {
      users.clear();
      sessions.clear();
    },
  };
});

vi.mock('../src/lib/prisma.js', () => ({ prisma: mockPrisma }));

describe('authentication', () => {
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

  async function register(
    body: Record<string, unknown>,
  ): Promise<{ status: number; body: { accessToken?: string; refreshToken?: string } }> {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: body,
    });
    return { status: response.statusCode, body: JSON.parse(response.body) };
  }

  it('registers a user and returns tokens', async () => {
    const { status, body } = await register({
      email: 'user@example.com',
      password: 'supersecret123',
      displayName: 'Test User',
    });

    expect(status).toBe(201);
    expect(body.accessToken).toEqual(expect.any(String));
    expect(body.refreshToken).toEqual(expect.any(String));
  });

  it('rejects a duplicate email with 409', async () => {
    await register({ email: 'dup@example.com', password: 'supersecret123' });
    const { status } = await register({ email: 'dup@example.com', password: 'supersecret123' });

    expect(status).toBe(409);
  });

  it('rejects a short password with 400', async () => {
    const { status } = await register({ email: 'short@example.com', password: 'short' });

    expect(status).toBe(400);
  });

  it('logs in with correct credentials', async () => {
    await register({ email: 'login@example.com', password: 'supersecret123' });

    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'login@example.com', password: 'supersecret123' },
    });
    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(200);
    expect(body.accessToken).toEqual(expect.any(String));
    expect(body.refreshToken).toEqual(expect.any(String));
  });

  it('rejects login with wrong password', async () => {
    await register({ email: 'wrong@example.com', password: 'supersecret123' });

    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'wrong@example.com', password: 'not-the-password' },
    });

    expect(response.statusCode).toBe(401);
  });

  it('returns the current user for a valid access token', async () => {
    await register({ email: 'me@example.com', password: 'supersecret123' });
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'me@example.com', password: 'supersecret123' },
    });
    const { accessToken } = JSON.parse(login.body);

    const response = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: `Bearer ${accessToken}` },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).user.email).toBe('me@example.com');
  });

  it('rejects /auth/me without a token', async () => {
    const response = await app.inject({ method: 'GET', url: '/auth/me' });

    expect(response.statusCode).toBe(401);
  });

  it('rejects /auth/me with an invalid token', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: 'Bearer not-a-real-token' },
    });

    expect(response.statusCode).toBe(401);
  });

  it('rotates the refresh token', async () => {
    await register({ email: 'rotate@example.com', password: 'supersecret123' });
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'rotate@example.com', password: 'supersecret123' },
    });
    const { refreshToken } = JSON.parse(login.body);

    const first = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken },
    });
    const firstBody = JSON.parse(first.body);
    expect(first.statusCode).toBe(200);
    expect(firstBody.refreshToken).not.toBe(refreshToken);

    const second = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken },
    });
    expect(second.statusCode).toBe(401);
  });

  it('invalidates the refresh token on logout', async () => {
    await register({ email: 'logout@example.com', password: 'supersecret123' });
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'logout@example.com', password: 'supersecret123' },
    });
    const { refreshToken } = JSON.parse(login.body);

    const logout = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      payload: { refreshToken },
    });
    expect(logout.statusCode).toBe(204);

    const refresh = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken },
    });
    expect(refresh.statusCode).toBe(401);
  });
});

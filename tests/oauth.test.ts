import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

process.env.DATABASE_URL = '';
process.env.REDIS_URL = '';
process.env.JWT_SECRET = 'test-access-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
process.env.GOOGLE_CLIENT_ID = 'test-client-id';
process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
process.env.GOOGLE_REDIRECT_URI = 'http://localhost:3000/api/v1/auth/google/callback';
process.env.CORS_ORIGIN = 'http://localhost:3001';

type MockUser = {
  id: string;
  email: string;
  passwordHash: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  googleId: string | null;
  role: 'USER' | 'ADMIN';
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

type MockAccount = {
  id: string;
  userId: string;
  provider: string;
  providerAccountId: string;
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: Date | null;
};

const { mockPrisma, resetDb, getUsers, getAccounts } = vi.hoisted(() => {
  const users = new Map<string, MockUser>();
  const accounts = new Map<string, MockAccount>();

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
    async create(args: {
      data: {
        email: string;
        displayName?: string | null;
        avatarUrl?: string | null;
        googleId?: string | null;
      };
      select?: unknown;
    }): Promise<MockUser> {
      const now = new Date();
      const user: MockUser = {
        id: randomUUID(),
        email: args.data.email,
        passwordHash: null,
        displayName: args.data.displayName ?? null,
        avatarUrl: args.data.avatarUrl ?? null,
        googleId: args.data.googleId ?? null,
        role: 'USER',
        isActive: true,
        createdAt: now,
        updatedAt: now,
      };
      users.set(user.id, user);
      return user;
    },
    async update(args: { where: { id: string }; data: Partial<MockUser> }): Promise<MockUser> {
      const user = users.get(args.where.id);
      if (!user) {
        throw new Error('User not found');
      }
      const updated = { ...user, ...args.data, updatedAt: new Date() };
      users.set(user.id, updated);
      return updated;
    },
  };

  const accountModel = {
    async findUnique(args: {
      where: {
        provider_providerAccountId?: { provider: string; providerAccountId: string };
        id?: string;
      };
    }): Promise<MockAccount | null> {
      if (args.where.id !== undefined) {
        return accounts.get(args.where.id) ?? null;
      }
      const composite = args.where.provider_providerAccountId;
      if (composite) {
        for (const account of accounts.values()) {
          if (
            account.provider === composite.provider &&
            account.providerAccountId === composite.providerAccountId
          ) {
            return account;
          }
        }
      }
      return null;
    },
    async create(args: {
      data: {
        userId: string;
        provider: string;
        providerAccountId: string;
        accessToken?: string | null;
        refreshToken?: string | null;
        expiresAt?: Date | null;
      };
    }): Promise<MockAccount> {
      const account: MockAccount = {
        id: randomUUID(),
        userId: args.data.userId,
        provider: args.data.provider,
        providerAccountId: args.data.providerAccountId,
        accessToken: args.data.accessToken ?? null,
        refreshToken: args.data.refreshToken ?? null,
        expiresAt: args.data.expiresAt ?? null,
      };
      accounts.set(account.id, account);
      return account;
    },
    async update(args: {
      where: { id: string };
      data: Partial<MockAccount>;
    }): Promise<MockAccount> {
      const account = accounts.get(args.where.id);
      if (!account) {
        throw new Error('Account not found');
      }
      const updated = { ...account, ...args.data };
      accounts.set(account.id, updated);
      return updated;
    },
  };

  const sessionModel = {
    async create(args: {
      data: { userId: string; token: string; expiresAt: Date };
    }): Promise<{ id: string; token: string }> {
      return { id: randomUUID(), token: args.data.token };
    },
  };

  return {
    mockPrisma: {
      user: userModel,
      account: accountModel,
      session: sessionModel,
      $disconnect: async (): Promise<void> => undefined,
    },
    resetDb: (): void => {
      users.clear();
      accounts.clear();
    },
    getUsers: (): MockUser[] => [...users.values()],
    getAccounts: (): MockAccount[] => [...accounts.values()],
  };
});

vi.mock('../src/lib/prisma.js', () => ({ prisma: mockPrisma }));

describe('Google OAuth when configured', () => {
  let app: FastifyInstance;

  const fetchMock = vi.fn(async (url: string | URL | Request) => {
    const href = String(url);
    if (href.includes('oauth2.googleapis.com/token')) {
      return new Response(
        JSON.stringify({
          access_token: 'google-access',
          refresh_token: 'google-refresh',
          expires_in: 3600,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    if (href.includes('oauth2/v3/userinfo')) {
      return new Response(
        JSON.stringify({
          sub: 'google-sub-123',
          email: 'oauth@example.com',
          name: 'OAuth User',
          picture: 'https://pics.example/me.png',
          email_verified: true,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    return new Response('not found', { status: 404 });
  });

  beforeAll(async () => {
    vi.stubGlobal('fetch', fetchMock);
    const { buildApp } = await import('../src/app.js');
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    resetDb();
    fetchMock.mockClear();
  });

  async function startFlow(): Promise<{ cookie: string; state: string }> {
    const response = await app.inject({ method: 'GET', url: '/api/v1/auth/google' });
    const location = new URL(response.headers.location as string);
    const setCookie = response.headers['set-cookie'];
    const cookieHeader = Array.isArray(setCookie)
      ? setCookie.map((c) => c.split(';')[0]).join('; ')
      : (String(setCookie).split(';')[0] ?? '');
    return { cookie: cookieHeader, state: location.searchParams.get('state') ?? '' };
  }

  it('reports email and google providers when configured', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/auth/providers' });
    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(200);
    expect(body.providers.map((p: { id: string }) => p.id)).toEqual(['email', 'google']);
  });

  it('redirects to Google with a state cookie', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/auth/google' });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toContain('https://accounts.google.com/o/oauth2/v2/auth');
    expect(response.headers.location).toContain('client_id=test-client-id');
    expect(response.headers['set-cookie']).toBeDefined();
  });

  it('creates a user and account on a successful callback', async () => {
    const { cookie, state } = await startFlow();

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/auth/google/callback?code=good-code&state=${encodeURIComponent(state)}`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(302);
    const location = response.headers.location as string;
    expect(location.startsWith('http://localhost:3001/auth/callback#access_token=')).toBe(true);
    expect(location).toContain('refresh_token=');

    expect(getUsers()).toHaveLength(1);
    expect(getUsers()[0]!.email).toBe('oauth@example.com');
    expect(getUsers()[0]!.googleId).toBe('google-sub-123');
    expect(getAccounts()).toHaveLength(1);
    expect(getAccounts()[0]!.provider).toBe('google');
    expect(getAccounts()[0]!.accessToken).toBe('google-access');
  });

  it('links to an existing user by email instead of creating a duplicate', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'oauth@example.com', password: 'supersecret123' },
    });
    const { cookie, state } = await startFlow();

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/auth/google/callback?code=good-code&state=${encodeURIComponent(state)}`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(302);
    expect(getUsers()).toHaveLength(1);
    expect(getUsers()[0]!.googleId).toBe('google-sub-123');
    expect(getAccounts()).toHaveLength(1);
  });

  it('rejects a callback with a mismatched state', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/google/callback?code=good-code&state=wrong-state',
      headers: { cookie: 'oauth_state=expected-state' },
    });

    expect(response.statusCode).toBe(400);
    expect(getUsers()).toHaveLength(0);
  });

  it('rejects a callback without a code', async () => {
    const { cookie, state } = await startFlow();

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/auth/google/callback?state=${encodeURIComponent(state)}`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(400);
  });
});

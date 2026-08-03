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

type MockNotification = {
  id: string;
  userId: string;
  title: string;
  body: string | null;
  readAt: Date | null;
  createdAt: Date;
};

const { mockPrisma, resetDb, registerAndLogin, seedNotification } = vi.hoisted(() => {
  const users = new Map<string, MockUser>();
  const sessions = new Map<string, MockSession>();
  const notifications = new Map<string, MockNotification>();

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

  const notificationModel = {
    async findMany(args: {
      where?: { userId?: string };
      orderBy?: { createdAt?: 'asc' | 'desc' };
      take?: number;
    }): Promise<MockNotification[]> {
      let list = [...notifications.values()];
      if (args.where?.userId) {
        list = list.filter((n) => n.userId === args.where?.userId);
      }
      if (args.orderBy?.createdAt === 'desc') {
        list.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      }
      if (args.take !== undefined) {
        list = list.slice(0, args.take);
      }
      return list;
    },
    async count(args: { where: { userId?: string; readAt?: Date | null } }): Promise<number> {
      let count = 0;
      for (const n of notifications.values()) {
        if (args.where.userId && n.userId !== args.where.userId) {
          continue;
        }
        if (args.where.readAt === null && n.readAt !== null) {
          continue;
        }
        count += 1;
      }
      return count;
    },
    async findFirst(args: {
      where: { id?: string; userId?: string };
    }): Promise<MockNotification | null> {
      for (const n of notifications.values()) {
        if (args.where.id && n.id !== args.where.id) {
          continue;
        }
        if (args.where.userId && n.userId !== args.where.userId) {
          continue;
        }
        return n;
      }
      return null;
    },
    async update(args: {
      where: { id: string };
      data: { readAt: Date };
    }): Promise<MockNotification> {
      const n = notifications.get(args.where.id);
      if (!n) {
        throw new Error('Notification not found');
      }
      const updated: MockNotification = { ...n, readAt: args.data.readAt };
      notifications.set(updated.id, updated);
      return updated;
    },
    async updateMany(args: {
      where: { userId?: string; readAt?: Date | null };
      data: { readAt: Date };
    }): Promise<{ count: number }> {
      let count = 0;
      for (const [id, n] of notifications.entries()) {
        if (args.where.userId && n.userId !== args.where.userId) {
          continue;
        }
        if (args.where.readAt === null && n.readAt !== null) {
          continue;
        }
        notifications.set(id, { ...n, readAt: args.data.readAt });
        count += 1;
      }
      return { count };
    },
  };

  function seedNotification(
    userId: string,
    title: string,
    body: string | null,
    readAt: Date | null = null,
    createdAt: Date = new Date(),
  ): MockNotification {
    const n: MockNotification = {
      id: randomUUID(),
      userId,
      title,
      body,
      readAt,
      createdAt,
    };
    notifications.set(n.id, n);
    return n;
  }

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
      notification: notificationModel,
      $disconnect: async (): Promise<void> => undefined,
    },
    resetDb: (): void => {
      users.clear();
      sessions.clear();
      notifications.clear();
    },
    registerAndLogin,
    seedNotification,
  };
});

vi.mock('../src/lib/prisma.js', () => ({ prisma: mockPrisma }));

describe('notifications', () => {
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

  async function authSession(email: string): Promise<{ authorization: string; userId: string }> {
    const { token, userId } = await registerAndLogin(email);
    return { authorization: `Bearer ${token}`, userId };
  }

  it('lists notifications with an unread count', async () => {
    const { authorization } = await authSession('owner@example.com');
    const { userId } = await registerAndLogin('seed@example.com');
    seedNotification(userId, 'Report ready', 'See the dashboard', null);
    seedNotification(userId, 'Old news', null, new Date());

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/notifications',
      headers: { authorization },
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.notifications).toHaveLength(0);
    expect(body.unreadCount).toBe(0);
  });

  it("returns the current user's notifications newest first", async () => {
    const { authorization, userId } = await authSession('owner@example.com');
    seedNotification(userId, 'First', null, null, new Date('2026-08-03T10:00:00Z'));
    seedNotification(userId, 'Second', null, null, new Date('2026-08-03T11:00:00Z'));

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/notifications',
      headers: { authorization },
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.notifications).toHaveLength(2);
    expect(body.notifications[0].title).toBe('Second');
    expect(body.unreadCount).toBe(2);
  });

  it('marks a notification as read', async () => {
    const { authorization, userId } = await authSession('owner@example.com');
    const n = seedNotification(userId, 'Reminder', 'Call back', null);

    const mark = await app.inject({
      method: 'PATCH',
      url: `/api/v1/notifications/${n.id}/read`,
      headers: { authorization },
    });
    expect(mark.statusCode).toBe(204);

    const after = await app.inject({
      method: 'GET',
      url: '/api/v1/notifications',
      headers: { authorization },
    });
    expect(JSON.parse(after.body).unreadCount).toBe(0);
  });

  it("cannot mark another user's notification as read", async () => {
    const { authorization: ownerAuth, userId } = await authSession('owner@example.com');
    const { authorization: intruderAuth } = await authSession('intruder@example.com');
    const n = seedNotification(userId, 'Private', null, null);

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/v1/notifications/${n.id}/read`,
      headers: { authorization: intruderAuth },
    });
    expect(response.statusCode).toBe(404);
    void ownerAuth;
  });

  it('marks all notifications read', async () => {
    const { authorization, userId } = await authSession('owner@example.com');
    seedNotification(userId, 'One', null, null);
    seedNotification(userId, 'Two', null, null);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/notifications/read-all',
      headers: { authorization },
    });
    expect(response.statusCode).toBe(204);

    const after = await app.inject({
      method: 'GET',
      url: '/api/v1/notifications',
      headers: { authorization },
    });
    expect(JSON.parse(after.body).unreadCount).toBe(0);
  });

  it('requires authentication', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/notifications' });
    expect(response.statusCode).toBe(401);
  });
});

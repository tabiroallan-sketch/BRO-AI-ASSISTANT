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

type MockConversation = {
  id: string;
  userId: string;
  title: string | null;
  metadata: unknown;
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

const { mockPrisma, resetDb, registerAndLogin } = vi.hoisted(() => {
  const users = new Map<string, MockUser>();
  const sessions = new Map<string, MockSession>();
  const conversations = new Map<string, MockConversation>();
  const messages = new Map<string, MockMessage>();

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

  const conversationModel = {
    async findMany(args: {
      where?: { userId?: string };
      orderBy?: { updatedAt?: 'asc' | 'desc' };
      select?: { _count?: { select?: unknown } };
    }): Promise<
      Array<
        MockConversation & {
          _count?: { messages: number };
        }
      >
    > {
      let list = [...conversations.values()];
      if (args.where?.userId) {
        list = list.filter((conversation) => conversation.userId === args.where?.userId);
      }
      if (args.orderBy?.updatedAt === 'desc') {
        list.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
      }
      if (args.select?._count) {
        return list.map((conversation) => ({
          ...conversation,
          _count: {
            messages: [...messages.values()].filter(
              (message) => message.conversationId === conversation.id,
            ).length,
          },
        }));
      }
      return list;
    },
    async create(args: {
      data: { userId: string; title: string | null };
    }): Promise<MockConversation> {
      const now = new Date();
      const conversation: MockConversation = {
        id: randomUUID(),
        userId: args.data.userId,
        title: args.data.title ?? null,
        metadata: {},
        createdAt: now,
        updatedAt: now,
      };
      conversations.set(conversation.id, conversation);
      return conversation;
    },
    async findFirst(args: {
      where: { id?: string; userId?: string };
      include?: { messages?: { orderBy?: unknown; select?: unknown } };
    }): Promise<(MockConversation & { messages?: MockMessage[] }) | null> {
      for (const conversation of conversations.values()) {
        if (args.where.id && conversation.id !== args.where.id) {
          continue;
        }
        if (args.where.userId && conversation.userId !== args.where.userId) {
          continue;
        }
        if (args.include?.messages) {
          const thread = [...messages.values()]
            .filter((message) => message.conversationId === conversation.id)
            .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
          return { ...conversation, messages: thread };
        }
        return conversation;
      }
      return null;
    },
    async update(args: {
      where: { id: string };
      data: { title?: string | null; updatedAt?: Date; metadata?: unknown };
    }): Promise<MockConversation> {
      const conversation = conversations.get(args.where.id);
      if (!conversation) {
        throw new Error('Conversation not found');
      }
      const updated: MockConversation = {
        ...conversation,
        ...(args.data.title !== undefined ? { title: args.data.title } : {}),
        ...(args.data.updatedAt ? { updatedAt: args.data.updatedAt } : {}),
        ...(args.data.metadata !== undefined ? { metadata: args.data.metadata } : {}),
      };
      conversations.set(updated.id, updated);
      return updated;
    },
    async delete(args: { where: { id: string } }): Promise<unknown> {
      conversations.delete(args.where.id);
      for (const [id, message] of messages) {
        if (message.conversationId === args.where.id) {
          messages.delete(id);
        }
      }
      return {};
    },
    async deleteMany(args: {
      where: { id?: string; userId?: string };
    }): Promise<{ count: number }> {
      const targets = [...conversations.values()].filter((conversation) => {
        if (args.where.id && conversation.id !== args.where.id) {
          return false;
        }
        if (args.where.userId && conversation.userId !== args.where.userId) {
          return false;
        }
        return true;
      });
      for (const target of targets) {
        conversations.delete(target.id);
        for (const [id, message] of messages) {
          if (message.conversationId === target.id) {
            messages.delete(id);
          }
        }
      }
      return { count: targets.length };
    },
  };

  const messageModel = {
    async create(args: {
      data: { conversationId: string; role: MockMessage['role']; content: string };
    }): Promise<MockMessage> {
      const message: MockMessage = {
        id: randomUUID(),
        conversationId: args.data.conversationId,
        role: args.data.role,
        content: args.data.content,
        createdAt: new Date(),
      };
      messages.set(message.id, message);
      return message;
    },
    async findMany(args: {
      where: { conversationId: string };
      orderBy?: { createdAt?: 'asc' | 'desc' };
      take?: number;
      select?: unknown;
    }): Promise<MockMessage[]> {
      let list = [...messages.values()].filter(
        (message) => message.conversationId === args.where.conversationId,
      );
      if (args.orderBy?.createdAt === 'asc') {
        list.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
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
      conversation: conversationModel,
      message: messageModel,
      $disconnect: async (): Promise<void> => undefined,
    },
    resetDb: (): void => {
      users.clear();
      sessions.clear();
      conversations.clear();
      messages.clear();
    },
    registerAndLogin,
  };
});

vi.mock('../src/lib/prisma.js', () => ({ prisma: mockPrisma }));

describe('conversations', () => {
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

  it('creates, lists, gets, renames and deletes a conversation', async () => {
    const headers = await authHeaders('owner@example.com');

    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/conversations',
      headers,
      payload: { title: 'My chat' },
    });
    expect(create.statusCode).toBe(201);
    const { conversation } = JSON.parse(create.body);
    expect(conversation.title).toBe('My chat');
    expect(conversation.messageCount).toBe(0);

    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/conversations',
      headers,
    });
    expect(list.statusCode).toBe(200);
    const { conversations } = JSON.parse(list.body);
    expect(conversations).toHaveLength(1);
    expect(conversations[0].id).toBe(conversation.id);

    const get = await app.inject({
      method: 'GET',
      url: `/api/v1/conversations/${conversation.id}`,
      headers,
    });
    expect(get.statusCode).toBe(200);
    expect(JSON.parse(get.body).conversation.messages).toEqual([]);

    const rename = await app.inject({
      method: 'PATCH',
      url: `/api/v1/conversations/${conversation.id}`,
      headers,
      payload: { title: 'Renamed' },
    });
    expect(rename.statusCode).toBe(200);
    expect(JSON.parse(rename.body).conversation.title).toBe('Renamed');

    const remove = await app.inject({
      method: 'DELETE',
      url: `/api/v1/conversations/${conversation.id}`,
      headers,
    });
    expect(remove.statusCode).toBe(204);

    const after = await app.inject({
      method: 'GET',
      url: `/api/v1/conversations/${conversation.id}`,
      headers,
    });
    expect(after.statusCode).toBe(404);
  });

  it('creates a conversation without a title', async () => {
    const headers = await authHeaders('untitled@example.com');

    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/conversations',
      headers,
      payload: {},
    });

    expect(create.statusCode).toBe(201);
    expect(JSON.parse(create.body).conversation.title).toBeNull();
  });

  it('rejects access to another user conversation', async () => {
    const owner = await authHeaders('owner@example.com');
    const intruder = await authHeaders('intruder@example.com');

    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/conversations',
      headers: owner,
      payload: { title: 'Private' },
    });
    const { conversation } = JSON.parse(create.body);

    const get = await app.inject({
      method: 'GET',
      url: `/api/v1/conversations/${conversation.id}`,
      headers: intruder,
    });
    expect(get.statusCode).toBe(404);

    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/v1/conversations/${conversation.id}`,
      headers: intruder,
      payload: { title: 'Hijacked' },
    });
    expect(patch.statusCode).toBe(404);

    const remove = await app.inject({
      method: 'DELETE',
      url: `/api/v1/conversations/${conversation.id}`,
      headers: intruder,
    });
    expect(remove.statusCode).toBe(404);
  });

  it('requires authentication', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/conversations' });
    expect(response.statusCode).toBe(401);
  });

  it('rejects an invalid rename body with 400', async () => {
    const headers = await authHeaders('bad@example.com');

    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/conversations',
      headers,
      payload: {},
    });
    const { conversation } = JSON.parse(create.body);

    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/v1/conversations/${conversation.id}`,
      headers,
      payload: { title: '   ' },
    });
    expect(patch.statusCode).toBe(400);
  });
});

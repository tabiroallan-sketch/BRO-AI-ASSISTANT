import { randomUUID } from 'node:crypto';
import { signAccessToken } from '../../src/lib/jwt.js';

export type MockRole = 'USER' | 'ADMIN';

export type MockUser = {
  id: string;
  email: string;
  passwordHash: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  role: MockRole;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type MockSession = {
  id: string;
  userId: string;
  token: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

export type MockConversation = {
  id: string;
  userId: string;
  title: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type MockMessage = {
  id: string;
  conversationId: string;
  role: 'USER' | 'ASSISTANT' | 'SYSTEM';
  content: string;
  createdAt: Date;
};

export type MockMemory = {
  id: string;
  userId: string;
  key: string;
  value: string;
  category: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type MockNotification = {
  id: string;
  userId: string;
  title: string;
  body: string | null;
  readAt: Date | null;
  createdAt: Date;
};

export type MockDb = {
  mockPrisma: unknown;
  registerAndLogin: (email: string, role?: MockRole) => Promise<string>;
  seedConversation: (userId: string, title: string | null) => MockConversation;
  seedMemory: (userId: string, key: string, value: string) => MockMemory;
  seedNotification: (userId: string, title: string, body?: string) => MockNotification;
  resetDb: () => void;
  state: () => {
    users: number;
    conversations: number;
    messages: number;
    memories: number;
    notifications: number;
    sessions: number;
  };
};

let instance: MockDb | null = null;

export function getMockDb(): MockDb {
  if (instance) {
    return instance;
  }
  instance = createMockDb();
  return instance;
}

export function resetMockDb(): void {
  instance = null;
}

export function createMockDb(): MockDb {
  const users = new Map<string, MockUser>();
  const sessions = new Map<string, MockSession>();
  const conversations = new Map<string, MockConversation>();
  const messages = new Map<string, MockMessage>();
  const memories = new Map<string, MockMemory>();
  const notifications = new Map<string, MockNotification>();
  let lastMessageAt = 0;

  function nextCreatedAt(): Date {
    const now = Date.now();
    lastMessageAt = now > lastMessageAt ? now : lastMessageAt + 1;
    return new Date(lastMessageAt);
  }

  function getById<T extends { id: string }>(store: Map<string, T>, id: string): T | undefined {
    return store.get(id);
  }

  const userModel = {
    async findUnique(args: {
      where: { id?: string; email?: string };
      select?: Record<string, unknown>;
    }): Promise<MockUser | null> {
      let user: MockUser | undefined;
      if (args.where.id !== undefined) {
        user = getById(users, args.where.id);
      } else if (args.where.email !== undefined) {
        for (const candidate of users.values()) {
          if (candidate.email === args.where.email) {
            user = candidate;
            break;
          }
        }
      }
      return user ?? null;
    },
    async create(args: {
      data: {
        email: string;
        passwordHash?: string | null;
        displayName?: string | null;
        avatarUrl?: string | null;
        role?: MockRole;
      };
      select?: Record<string, unknown>;
    }): Promise<MockUser> {
      const now = new Date();
      const user: MockUser = {
        id: randomUUID(),
        email: args.data.email,
        passwordHash: args.data.passwordHash ?? null,
        displayName: args.data.displayName ?? null,
        avatarUrl: args.data.avatarUrl ?? null,
        role: args.data.role ?? 'USER',
        isActive: true,
        createdAt: now,
        updatedAt: now,
      };
      users.set(user.id, user);
      return user;
    },
    async update(args: {
      where: { id: string };
      data: { role?: MockRole; isActive?: boolean };
      select?: Record<string, unknown>;
    }): Promise<MockUser> {
      const user = getById(users, args.where.id);
      if (!user) {
        throw new Error('User not found');
      }
      const updated: MockUser = {
        ...user,
        ...(args.data.role !== undefined ? { role: args.data.role } : {}),
        ...(args.data.isActive !== undefined ? { isActive: args.data.isActive } : {}),
        updatedAt: new Date(),
      };
      users.set(updated.id, updated);
      return updated;
    },
  };

  const sessionModel = {
    async findFirst(args: {
      where: { token: string };
      include?: { user?: { select?: Record<string, unknown> } };
    }): Promise<(MockSession & { user?: MockUser }) | null> {
      for (const session of sessions.values()) {
        if (session.token === args.where.token) {
          const user = getById(users, session.userId);
          if (args.include?.user) {
            return user ? { ...session, user } : null;
          }
          return session;
        }
      }
      return null;
    },
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
    async delete(args: { where: { id: string } }): Promise<MockSession> {
      const session = getById(sessions, args.where.id);
      if (!session) {
        throw new Error('Session not found');
      }
      sessions.delete(session.id);
      return session;
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

  function messageMatches(message: MockMessage, where: Record<string, unknown>): boolean {
    if (where.conversationId !== undefined && message.conversationId !== where.conversationId) {
      return false;
    }
    if (where.role !== undefined && message.role !== where.role) {
      return false;
    }
    if (where.conversation !== undefined) {
      const nested = where.conversation as { userId?: string };
      const conversation = getById(conversations, message.conversationId);
      if (!conversation || (nested.userId !== undefined && conversation.userId !== nested.userId)) {
        return false;
      }
    }
    if (where.createdAt !== undefined) {
      const range = where.createdAt as { gte?: Date; lte?: Date };
      if (range.gte !== undefined && message.createdAt < range.gte) {
        return false;
      }
      if (range.lte !== undefined && message.createdAt > range.lte) {
        return false;
      }
    }
    return true;
  }

  function conversationMatches(
    conversation: MockConversation,
    where: Record<string, unknown>,
  ): boolean {
    if (where.id !== undefined && conversation.id !== where.id) {
      return false;
    }
    if (where.userId !== undefined && conversation.userId !== where.userId) {
      return false;
    }
    return true;
  }

  function memoryMatches(memory: MockMemory, where: Record<string, unknown>): boolean {
    if (where.id !== undefined && memory.id !== where.id) {
      return false;
    }
    if (where.userId !== undefined && memory.userId !== where.userId) {
      return false;
    }
    if (where.key !== undefined && memory.key !== where.key) {
      return false;
    }
    return true;
  }

  function notificationMatches(
    notification: MockNotification,
    where: Record<string, unknown>,
  ): boolean {
    if (where.id !== undefined && notification.id !== where.id) {
      return false;
    }
    if (where.userId !== undefined && notification.userId !== where.userId) {
      return false;
    }
    if (where.readAt !== undefined && where.readAt !== null) {
      return false;
    }
    if (where.readAt === null && notification.readAt !== null) {
      return false;
    }
    return true;
  }

  const conversationModel = {
    async create(args: {
      data: { userId: string; title: string | null };
      select?: Record<string, unknown>;
    }): Promise<MockConversation> {
      const now = new Date();
      const conversation: MockConversation = {
        id: randomUUID(),
        userId: args.data.userId,
        title: args.data.title ?? null,
        createdAt: now,
        updatedAt: now,
      };
      conversations.set(conversation.id, conversation);
      return conversation;
    },
    async findMany(args: {
      where: { userId?: string };
      orderBy?: { updatedAt?: 'asc' | 'desc' };
      select?: Record<string, unknown>;
    }): Promise<(MockConversation & { _count?: { messages: number } })[]> {
      let list = [...conversations.values()].filter((conversation) =>
        conversationMatches(conversation, args.where ?? {}),
      );
      if (args.orderBy?.updatedAt === 'asc') {
        list.sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime());
      }
      if (args.orderBy?.updatedAt === 'desc') {
        list.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
      }
      return list.map((conversation) => ({
        ...conversation,
        _count: {
          messages: [...messages.values()].filter(
            (message) => message.conversationId === conversation.id,
          ).length,
        },
      }));
    },
    async findFirst(args: {
      where: { id?: string; userId?: string };
      include?: { messages?: { orderBy?: unknown; select?: Record<string, unknown> } };
    }): Promise<(MockConversation & { messages?: MockMessage[] }) | null> {
      for (const conversation of conversations.values()) {
        if (!conversationMatches(conversation, args.where ?? {})) {
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
      data: { title?: string | null; updatedAt?: Date };
      select?: Record<string, unknown>;
    }): Promise<MockConversation> {
      const conversation = getById(conversations, args.where.id);
      if (!conversation) {
        throw new Error('Conversation not found');
      }
      const updated: MockConversation = {
        ...conversation,
        ...(args.data.title !== undefined ? { title: args.data.title } : {}),
        ...(args.data.updatedAt ? { updatedAt: args.data.updatedAt } : {}),
      };
      conversations.set(updated.id, updated);
      return updated;
    },
    async deleteMany(args: { where: { id: string; userId?: string } }): Promise<{ count: number }> {
      let count = 0;
      for (const [id, conversation] of conversations) {
        if (conversationMatches(conversation, args.where ?? {})) {
          conversations.delete(id);
          for (const [messageId, message] of messages) {
            if (message.conversationId === id) {
              messages.delete(messageId);
            }
          }
          count += 1;
        }
      }
      return { count };
    },
    async count(args: { where: { userId: string } }): Promise<number> {
      let count = 0;
      for (const conversation of conversations.values()) {
        if (conversationMatches(conversation, args.where ?? {})) {
          count += 1;
        }
      }
      return count;
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
        createdAt: nextCreatedAt(),
      };
      messages.set(message.id, message);
      return message;
    },
    async findMany(args: {
      where: Record<string, unknown>;
      orderBy?: { createdAt?: 'asc' | 'desc' };
      take?: number;
      select?: Record<string, unknown>;
    }): Promise<MockMessage[]> {
      let list = [...messages.values()].filter((message) =>
        messageMatches(message, args.where ?? {}),
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
    async count(args: { where: Record<string, unknown> }): Promise<number> {
      let count = 0;
      for (const message of messages.values()) {
        if (messageMatches(message, args.where ?? {})) {
          count += 1;
        }
      }
      return count;
    },
  };

  const memoryModel = {
    async findMany(args: {
      where: { userId: string };
      orderBy?: { updatedAt?: 'asc' | 'desc' };
      take?: number;
      select?: Record<string, unknown>;
    }): Promise<MockMemory[]> {
      let list = [...memories.values()].filter((memory) => memoryMatches(memory, args.where ?? {}));
      if (args.orderBy?.updatedAt === 'asc') {
        list.sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime());
      }
      if (args.orderBy?.updatedAt === 'desc') {
        list.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
      }
      if (args.take !== undefined) {
        list = list.slice(0, args.take);
      }
      return list;
    },
    async findUnique(args: {
      where: { userId_key: { userId: string; key: string } };
      select?: Record<string, unknown>;
    }): Promise<MockMemory | null> {
      for (const memory of memories.values()) {
        if (
          memory.userId === args.where.userId_key.userId &&
          memory.key === args.where.userId_key.key
        ) {
          return memory;
        }
      }
      return null;
    },
    async findFirst(args: {
      where: { id: string; userId: string };
      select?: Record<string, unknown>;
    }): Promise<MockMemory | null> {
      for (const memory of memories.values()) {
        if (memoryMatches(memory, args.where ?? {})) {
          return memory;
        }
      }
      return null;
    },
    async upsert(args: {
      where: { userId_key: { userId: string; key: string } };
      create: { userId: string; key: string; value: string; category: string | null };
      update: { value: string; category?: string | null };
      select?: Record<string, unknown>;
    }): Promise<MockMemory> {
      const existing = await memoryModel.findUnique({ where: args.where });
      const now = new Date();
      if (existing) {
        const updated: MockMemory = {
          ...existing,
          value: args.update.value,
          ...(args.update.category !== undefined ? { category: args.update.category } : {}),
          updatedAt: now,
        };
        memories.set(updated.id, updated);
        return updated;
      }
      const memory: MockMemory = {
        id: randomUUID(),
        userId: args.create.userId,
        key: args.create.key,
        value: args.create.value,
        category: args.create.category,
        createdAt: now,
        updatedAt: now,
      };
      memories.set(memory.id, memory);
      return memory;
    },
    async update(args: {
      where: { id: string };
      data: { value?: string; category?: string | null };
      select?: Record<string, unknown>;
    }): Promise<MockMemory> {
      const memory = getById(memories, args.where.id);
      if (!memory) {
        throw new Error('Memory not found');
      }
      const updated: MockMemory = {
        ...memory,
        ...(args.data.value !== undefined ? { value: args.data.value } : {}),
        ...(args.data.category !== undefined ? { category: args.data.category } : {}),
        updatedAt: new Date(),
      };
      memories.set(updated.id, updated);
      return updated;
    },
    async deleteMany(args: { where: { id: string; userId?: string } }): Promise<{ count: number }> {
      let count = 0;
      for (const [id, memory] of memories) {
        if (memoryMatches(memory, args.where ?? {})) {
          memories.delete(id);
          count += 1;
        }
      }
      return { count };
    },
    async count(args: { where: { userId: string } }): Promise<number> {
      let count = 0;
      for (const memory of memories.values()) {
        if (memoryMatches(memory, args.where ?? {})) {
          count += 1;
        }
      }
      return count;
    },
  };

  const notificationModel = {
    async findMany(args: {
      where: { userId: string };
      orderBy?: { createdAt?: 'asc' | 'desc' };
      take?: number;
      select?: Record<string, unknown>;
    }): Promise<MockNotification[]> {
      let list = [...notifications.values()].filter((notification) =>
        notificationMatches(notification, args.where ?? {}),
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
    async count(args: { where: { userId: string; readAt?: Date | null } }): Promise<number> {
      let count = 0;
      for (const notification of notifications.values()) {
        if (notificationMatches(notification, args.where ?? {})) {
          count += 1;
        }
      }
      return count;
    },
    async findFirst(args: {
      where: { id: string; userId: string };
    }): Promise<MockNotification | null> {
      for (const notification of notifications.values()) {
        if (notificationMatches(notification, args.where ?? {})) {
          return notification;
        }
      }
      return null;
    },
    async update(args: {
      where: { id: string };
      data: { readAt: Date };
    }): Promise<MockNotification> {
      const notification = getById(notifications, args.where.id);
      if (!notification) {
        throw new Error('Notification not found');
      }
      const updated: MockNotification = { ...notification, readAt: args.data.readAt };
      notifications.set(updated.id, updated);
      return updated;
    },
    async updateMany(args: {
      where: { userId: string; readAt: Date | null };
      data: { readAt: Date };
    }): Promise<{ count: number }> {
      let count = 0;
      for (const [id, notification] of notifications) {
        if (notificationMatches(notification, args.where ?? {})) {
          notifications.set(id, { ...notification, readAt: args.data.readAt });
          count += 1;
        }
      }
      return { count };
    },
  };

  const integrationModel = {
    async count(args: { where: { userId: string } }): Promise<number> {
      void args;
      return 0;
    },
  };

  async function registerAndLogin(email: string, role: MockRole = 'USER'): Promise<string> {
    const now = new Date();
    const user: MockUser = {
      id: randomUUID(),
      email,
      passwordHash: 'hash',
      displayName: null,
      avatarUrl: null,
      role,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };
    users.set(user.id, user);
    sessions.set(randomUUID(), {
      id: randomUUID(),
      userId: user.id,
      token: `token-${user.id}`,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      createdAt: now,
      updatedAt: now,
    });
    return signAccessToken(user.id, user.role);
  }

  function seedConversation(userId: string, title: string | null): MockConversation {
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

  function seedMemory(userId: string, key: string, value: string): MockMemory {
    const now = new Date();
    const memory: MockMemory = {
      id: randomUUID(),
      userId,
      key,
      value,
      category: null,
      createdAt: now,
      updatedAt: now,
    };
    memories.set(memory.id, memory);
    return memory;
  }

  function seedNotification(userId: string, title: string, body = ''): MockNotification {
    const now = new Date();
    const notification: MockNotification = {
      id: randomUUID(),
      userId,
      title,
      body,
      readAt: null,
      createdAt: now,
    };
    notifications.set(notification.id, notification);
    return notification;
  }

  function resetDb(): void {
    users.clear();
    sessions.clear();
    conversations.clear();
    messages.clear();
    memories.clear();
    notifications.clear();
    lastMessageAt = 0;
  }

  function state(): {
    users: number;
    conversations: number;
    messages: number;
    memories: number;
    notifications: number;
    sessions: number;
  } {
    return {
      users: users.size,
      conversations: conversations.size,
      messages: messages.size,
      memories: memories.size,
      notifications: notifications.size,
      sessions: sessions.size,
    };
  }

  const mockPrisma = {
    user: userModel,
    session: sessionModel,
    conversation: conversationModel,
    message: messageModel,
    memory: memoryModel,
    notification: notificationModel,
    integration: integrationModel,
    $disconnect: async (): Promise<void> => undefined,
  };

  return {
    mockPrisma,
    registerAndLogin,
    seedConversation,
    seedMemory,
    seedNotification,
    resetDb,
    state,
  };
}

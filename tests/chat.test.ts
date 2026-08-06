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

type MockMemory = {
  id: string;
  userId: string;
  key: string;
  value: string;
  category: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type MockAiConfig = {
  id: string;
  providerId: string | null;
  model: string | null;
  apiKey: string | null;
  lastStatus: string | null;
  lastMessage: string | null;
  lastLatencyMs: number | null;
  lastTestedAt: Date | null;
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
  metadata: unknown;
  isPrimary: boolean;
  lastRefreshedAt: Date | null;
  refreshCount: number;
  revokedAt: Date | null;
  revokedReason: string | null;
  createdAt: Date;
  updatedAt: Date;
};

const { mockPrisma, resetDb, registerAndLogin, seedConversation, seedMemory, seedIntegration } =
  vi.hoisted(() => {
    const users = new Map<string, MockUser>();
    const sessions = new Map<string, MockSession>();
    const conversations = new Map<string, MockConversation>();
    const messages = new Map<string, MockMessage>();
    const memories = new Map<string, MockMemory>();
    const aiConfigs = new Map<string, MockAiConfig>();
    const integrations = new Map<string, MockIntegration>();
    let lastMessageAt = 0;

    function nextCreatedAt(): Date {
      const now = Date.now();
      lastMessageAt = now > lastMessageAt ? now : lastMessageAt + 1;
      return new Date(lastMessageAt);
    }

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

    const conversationModel = {
      async create(args: {
        data: { userId: string; title: string | null };
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
        data: { title?: string | null; updatedAt?: Date };
      }): Promise<MockConversation> {
        const conversation = conversations.get(args.where.id);
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

    const memoryModel = {
      async findMany(args: {
        where: { userId: string };
        take?: number;
        select?: unknown;
      }): Promise<MockMemory[]> {
        let list = [...memories.values()].filter((memory) => memory.userId === args.where.userId);
        if (args.take !== undefined) {
          list = list.slice(0, args.take);
        }
        return list;
      },
    };

    const aiConfigModel = {
      async findUnique(args: { where: { id: string } }): Promise<MockAiConfig | null> {
        return aiConfigs.get(args.where.id) ?? null;
      },
      async upsert(args: {
        where: { id: string };
        create: Partial<MockAiConfig>;
        update: Partial<MockAiConfig>;
      }): Promise<MockAiConfig> {
        const existing = aiConfigs.get(args.where.id);
        const merged: MockAiConfig = {
          id: args.where.id,
          providerId: null,
          model: null,
          apiKey: null,
          lastStatus: null,
          lastMessage: null,
          lastLatencyMs: null,
          lastTestedAt: null,
          ...existing,
          ...args.create,
          ...args.update,
        };
        aiConfigs.set(merged.id, merged);
        return merged;
      },
      async update(args: {
        where: { id: string };
        data: Partial<MockAiConfig>;
      }): Promise<MockAiConfig> {
        const existing = aiConfigs.get(args.where.id) ?? {
          id: args.where.id,
          providerId: null,
          model: null,
          apiKey: null,
          lastStatus: null,
          lastMessage: null,
          lastLatencyMs: null,
          lastTestedAt: null,
        };
        const merged: MockAiConfig = { ...existing, ...args.data, id: args.where.id };
        aiConfigs.set(merged.id, merged);
        return merged;
      },
    };

    const integrationModel = {
      async findFirst(args: {
        where: { userId: string; provider: string; isPrimary?: boolean };
      }): Promise<MockIntegration | null> {
        const matches = [...integrations.values()].filter(
          (integration) =>
            integration.userId === args.where.userId &&
            integration.provider === args.where.provider,
        );
        if (args.where.isPrimary) {
          return matches.find((integration) => integration.isPrimary) ?? null;
        }
        return matches[0] ?? null;
      },
      async findUnique(args: {
        where: {
          userId_provider_accountKey: { userId: string; provider: string; accountKey: string };
        };
      }): Promise<MockIntegration | null> {
        const { userId, provider, accountKey } = args.where.userId_provider_accountKey;
        for (const integration of integrations.values()) {
          if (
            integration.userId === userId &&
            integration.provider === provider &&
            integration.accountKey === accountKey
          ) {
            return integration;
          }
        }
        return null;
      },
      async findMany(args: { where: { userId: string } }): Promise<MockIntegration[]> {
        return [...integrations.values()].filter(
          (integration) => integration.userId === args.where.userId,
        );
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
      sessions.set(randomUUID(), {
        id: randomUUID(),
        userId: user.id,
        token: `token-${user.id}`,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
        createdAt: now,
        updatedAt: now,
      });

      const { signAccessToken } = await import('../src/lib/jwt.js');
      return signAccessToken(user.id, user.role);
    }

    async function seedConversation(
      userId: string,
      title: string | null,
    ): Promise<MockConversation> {
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

    function seedIntegration(
      userId: string,
      provider: string,
      options: { accountName?: string | null; accessToken?: string } = {},
    ): MockIntegration {
      const now = new Date();
      const integration: MockIntegration = {
        id: randomUUID(),
        userId,
        provider,
        accountKey: 'default',
        accountName: options.accountName ?? null,
        externalId: null,
        accessToken: options.accessToken ?? 'test-token',
        refreshToken: null,
        refreshTokenHash: null,
        tokenExpiresAt: null,
        scopes: null,
        metadata: null,
        isPrimary: true,
        lastRefreshedAt: null,
        refreshCount: 0,
        revokedAt: null,
        revokedReason: null,
        createdAt: now,
        updatedAt: now,
      };
      integrations.set(integration.id, integration);
      return integration;
    }

    return {
      mockPrisma: {
        user: userModel,
        session: sessionModel,
        conversation: conversationModel,
        message: messageModel,
        memory: memoryModel,
        aiConfig: aiConfigModel,
        integration: integrationModel,
        $disconnect: async (): Promise<void> => undefined,
      },
      resetDb: (): void => {
        users.clear();
        sessions.clear();
        conversations.clear();
        messages.clear();
        memories.clear();
        aiConfigs.clear();
        integrations.clear();
        lastMessageAt = 0;
      },
      registerAndLogin,
      seedConversation,
      seedMemory,
      seedIntegration,
    };
  });

const { mockStreamChatCompletion, mockProvidersList, mockFallbackExecute } = vi.hoisted(() => {
  const fakeProvider = {
    descriptor: {
      id: 'test',
      label: 'Test',
      requiresApiKey: false,
      envVar: 'TEST_API_KEY',
      defaultBaseUrl: '',
      defaultModel: 'test-model',
    },
    initialize: async (): Promise<void> => undefined,
    streamChat: async function* (request: {
      messages: unknown[];
      tools?: unknown[];
    }): AsyncGenerator<unknown> {
      yield* mockStreamChatCompletion(request.messages, request.tools);
    },
  };
  return {
    mockStreamChatCompletion: vi.fn<
      (
        messages: unknown[],
        tools?: unknown[],
      ) => AsyncGenerator<
        | { type: 'content'; content: string }
        | {
            type: 'tool_calls';
            toolCalls: {
              id: string;
              name: string;
              arguments: string;
              extraContent?: Record<string, unknown>;
            }[];
          }
      >
    >(),
    mockProvidersList: vi.fn<() => unknown[]>(),
    mockFallbackExecute: vi.fn(
      async <T>(fn: (provider: typeof fakeProvider) => Promise<T>): Promise<T> => fn(fakeProvider),
    ),
  };
});

vi.mock('../src/lib/prisma.js', () => ({ prisma: mockPrisma }));
vi.mock('../src/llm/index.js', () => ({
  aiConfigStore: {
    get: async () => ({
      id: 'global',
      providerId: null,
      model: null,
      apiKey: null,
      lastStatus: null,
      lastMessage: null,
      lastLatencyMs: null,
      lastTestedAt: null,
    }),
    loadIntoRuntime: async (): Promise<void> => undefined,
  },
  modelManager: { resolveModel: async () => undefined },
  providerFallback: { execute: mockFallbackExecute },
  providerRegistry: { list: mockProvidersList, get: () => undefined },
}));

describe('chat', () => {
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
    mockProvidersList.mockReturnValue([{ descriptor: { requiresApiKey: false } }]);
    mockStreamChatCompletion.mockReset();
    mockStreamChatCompletion.mockImplementation(async function* () {
      yield { type: 'content', content: 'Hello world' };
    });
  });

  async function authHeaders(email: string): Promise<{ authorization: string }> {
    const token = await registerAndLogin(email);
    return { authorization: `Bearer ${token}` };
  }

  it('streams a chat response and persists both messages', async () => {
    const headers = await authHeaders('chat@example.com');

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/chat',
      headers,
      payload: { message: 'Hi there' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');

    const events = response.body
      .split('\n\n')
      .filter((line) => line.startsWith('data: '))
      .map((line) => JSON.parse(line.slice('data: '.length)));

    const types = events.map((event) => event.type);
    expect(types).toEqual(['start', 'delta', 'done']);

    const start = events[0];
    expect(start.conversationId).toEqual(expect.any(String));
    expect(start.messageId).toEqual(expect.any(String));

    const deltas = events
      .filter((event) => event.type === 'delta')
      .map((event) => event.content)
      .join('');
    expect(deltas).toBe('Hello world');

    const done = events[events.length - 1];
    expect(done.message.content).toBe('Hello world');
    expect(done.message.role).toBe('ASSISTANT');

    expect(mockStreamChatCompletion).toHaveBeenCalledTimes(1);
    const aiMessages = mockStreamChatCompletion.mock.calls[0]![0] as {
      role: string;
      content: string;
    }[];
    expect(aiMessages[0]!.role).toBe('system');
    expect(aiMessages[aiMessages.length - 1]).toEqual({ role: 'user', content: 'Hi there' });

    const get = await app.inject({
      method: 'GET',
      url: `/api/v1/conversations/${start.conversationId}`,
      headers,
    });
    const { conversation } = JSON.parse(get.body);
    expect(conversation.title).toBe('Hi there');
    expect(conversation.messages).toHaveLength(2);
    expect(conversation.messages[0].role).toBe('USER');
    expect(conversation.messages[0].content).toBe('Hi there');
    expect(conversation.messages[1].role).toBe('ASSISTANT');
    expect(conversation.messages[1].content).toBe('Hello world');
  });

  it('serves the SSE stream with CORS headers for cross-origin browsers', async () => {
    const headers = await authHeaders('cors@example.com');

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/chat',
      headers: { ...headers, origin: 'http://localhost:3001' },
      payload: { message: 'Hi there' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');
    // The chat route hijacks the reply, which bypasses the @fastify/cors
    // onSend hook; without these headers a browser silently drops the stream.
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:3001');
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });

  it('appends to an existing conversation', async () => {
    const headers = await authHeaders('thread@example.com');
    await registerAndLogin('thread@example.com');

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/chat',
      headers,
      payload: { message: 'First message' },
    });
    const firstEvents = first.body
      .split('\n\n')
      .filter((line) => line.startsWith('data: '))
      .map((line) => JSON.parse(line.slice('data: '.length)));
    const conversationId = firstEvents[0].conversationId;

    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/chat',
      headers,
      payload: { conversationId, message: 'Second message' },
    });
    expect(second.statusCode).toBe(200);

    const get = await app.inject({
      method: 'GET',
      url: `/api/v1/conversations/${conversationId}`,
      headers,
    });
    const { conversation } = JSON.parse(get.body);
    expect(conversation.messages).toHaveLength(4);
    expect(conversation.messages[0].content).toBe('First message');
    expect(conversation.messages[2].content).toBe('Second message');

    const historyCall = mockStreamChatCompletion.mock.calls[1]![0] as {
      role: string;
      content: string;
    }[];
    expect(historyCall).toHaveLength(4);
    expect(historyCall[0]!.role).toBe('system');
    expect(historyCall.slice(1).map((entry) => entry.content)).toEqual([
      'First message',
      'Hello world',
      'Second message',
    ]);
  });

  it('injects stored memories into the system prompt', async () => {
    const token = await registerAndLogin('mem@example.com');
    const headers = { authorization: `Bearer ${token}` };
    const { verifyAccessToken } = await import('../src/lib/jwt.js');
    const payload = await verifyAccessToken(token);
    seedMemory(payload.sub, 'name', 'Alice');
    seedMemory(payload.sub, 'timezone', 'Europe/Berlin');

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/chat',
      headers,
      payload: { message: 'Hi' },
    });

    expect(response.statusCode).toBe(200);
    const aiMessages = mockStreamChatCompletion.mock.calls[0]![0] as {
      role: string;
      content: string;
    }[];
    expect(aiMessages[0]!.role).toBe('system');
    expect(aiMessages[0]!.content).toContain('- name: Alice');
    expect(aiMessages[0]!.content).toContain('- timezone: Europe/Berlin');
  });

  it('injects integration awareness into the system prompt', async () => {
    const token = await registerAndLogin('aware@example.com');
    const headers = { authorization: `Bearer ${token}` };
    const { verifyAccessToken } = await import('../src/lib/jwt.js');
    const payload = await verifyAccessToken(token);
    seedIntegration(payload.sub, 'google-gmail', { accountName: 'alice@gmail.com' });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/chat',
      headers,
      payload: { message: 'Hi' },
    });

    expect(response.statusCode).toBe(200);
    const aiMessages = mockStreamChatCompletion.mock.calls[0]![0] as {
      role: string;
      content: string;
    }[];
    expect(aiMessages[0]!.role).toBe('system');
    expect(aiMessages[0]!.content).toContain('Connected accounts you can act on directly');
    expect(aiMessages[0]!.content).toContain('Gmail');
    expect(aiMessages[0]!.content).toContain('alice@gmail.com');
  });

  it('flags a disconnected provider tool with a connect action', async () => {
    const headers = await authHeaders('noconnect@example.com');
    mockStreamChatCompletion
      .mockImplementationOnce(async function* () {
        yield {
          type: 'tool_calls',
          toolCalls: [
            {
              id: 'call_gmail',
              name: 'gmail_search',
              arguments: '{"query":"from:acme"}',
            },
          ],
        };
      })
      .mockImplementationOnce(async function* () {
        yield { type: 'content', content: 'You are not connected to Gmail.' };
      });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/chat',
      headers,
      payload: { message: 'search my inbox' },
    });

    expect(response.statusCode).toBe(200);
    const events = parseEvents(response);
    const toolResult = events.find((event) => event.type === 'tool_result');
    expect(toolResult).toMatchObject({
      name: 'gmail_search',
      ok: false,
      connectProviderId: 'google-gmail',
      connectLabel: 'Gmail',
    });
    expect(toolResult?.output).toContain('not connected');
    expect(toolResult?.permissionDenied).toBeUndefined();

    const secondCall = mockStreamChatCompletion.mock.calls[1]![0] as {
      role: string;
      content: string;
    }[];
    expect(secondCall[secondCall.length - 1]!.content).toContain('not connected');
  });

  it('rejects chat in a conversation the user does not own', async () => {
    const headers = await authHeaders('intruder@example.com');
    const ownerConversation = await seedConversation('some-other-user-id', 'Private');

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/chat',
      headers,
      payload: { conversationId: ownerConversation.id, message: 'peek' },
    });

    expect(response.statusCode).toBe(404);
  });

  it('returns 503 when the AI provider is not configured', async () => {
    mockProvidersList.mockReturnValue([]);
    const headers = await authHeaders('noai@example.com');

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/chat',
      headers,
      payload: { message: 'hello' },
    });

    expect(response.statusCode).toBe(503);
  });

  it('requires authentication', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/chat',
      payload: { message: 'hello' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('rejects an invalid body with 400', async () => {
    const headers = await authHeaders('invalid@example.com');

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/chat',
      headers,
      payload: { message: '   ' },
    });

    expect(response.statusCode).toBe(400);
  });

  type ChatEvent = {
    type: string;
    conversationId?: string;
    messageId?: string;
    content?: string;
    name?: string;
    args?: Record<string, unknown>;
    ok?: boolean;
    output?: string;
    message?: { id: string; role: string; content: string; createdAt: string };
  };

  function parseEvents(response: { body: string }): ChatEvent[] {
    return response.body
      .split('\n\n')
      .filter((line) => line.startsWith('data: '))
      .map((line) => JSON.parse(line.slice('data: '.length)) as ChatEvent);
  }

  it('executes a tool call and streams the final answer', async () => {
    const headers = await authHeaders('tools@example.com');
    mockStreamChatCompletion
      .mockImplementationOnce(async function* () {
        yield {
          type: 'tool_calls',
          toolCalls: [
            {
              id: 'call_1',
              name: 'echo',
              arguments: '{"text":"hi"}',
              extraContent: { google: { thought_signature: 'sig-abc' } },
            },
          ],
        };
      })
      .mockImplementationOnce(async function* () {
        yield { type: 'content', content: 'hi' };
      });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/chat',
      headers,
      payload: { message: 'echo hi' },
    });

    expect(response.statusCode).toBe(200);
    const events = parseEvents(response);
    expect(events.map((event) => event.type)).toEqual([
      'start',
      'tool_start',
      'tool_result',
      'delta',
      'done',
    ]);

    const toolStart = events.find((event) => event.type === 'tool_start');
    expect(toolStart).toMatchObject({ name: 'echo', args: { text: 'hi' } });

    const toolResult = events.find((event) => event.type === 'tool_result');
    expect(toolResult).toMatchObject({ name: 'echo', ok: true, output: 'hi' });

    const done = events[events.length - 1]!;
    expect(done.message?.content).toBe('hi');

    expect(mockStreamChatCompletion).toHaveBeenCalledTimes(2);
    const secondCall = mockStreamChatCompletion.mock.calls[1]![0] as {
      role: string;
      content: string | null;
      tool_call_id?: string;
      tool_calls?: {
        id: string;
        name: string;
        arguments: string;
        extraContent?: Record<string, unknown>;
      }[];
    }[];
    expect(secondCall[secondCall.length - 1]).toEqual({
      role: 'tool',
      tool_call_id: 'call_1',
      content: 'hi',
    });
    const assistant = secondCall[secondCall.length - 2]!;
    expect(assistant.role).toBe('assistant');
    expect(assistant.tool_calls).toEqual([
      {
        id: 'call_1',
        name: 'echo',
        arguments: '{"text":"hi"}',
        extraContent: { google: { thought_signature: 'sig-abc' } },
      },
    ]);
  });

  it('feeds an unknown tool back as an error result', async () => {
    const headers = await authHeaders('unknowntool@example.com');
    mockStreamChatCompletion
      .mockImplementationOnce(async function* () {
        yield {
          type: 'tool_calls',
          toolCalls: [{ id: 'call_2', name: 'nope', arguments: '{}' }],
        };
      })
      .mockImplementationOnce(async function* () {
        yield { type: 'content', content: 'done' };
      });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/chat',
      headers,
      payload: { message: 'run nope' },
    });

    expect(response.statusCode).toBe(200);
    const events = parseEvents(response);
    const toolResult = events.find((event) => event.type === 'tool_result');
    expect(toolResult).toMatchObject({ name: 'nope', ok: false });
    expect(toolResult?.output).toContain('unknown tool');

    const secondCall = mockStreamChatCompletion.mock.calls[1]![0] as {
      role: string;
      content: string;
    }[];
    expect(secondCall[secondCall.length - 1]!.content).toContain('unknown tool "nope"');
  });

  it('uses a real tool to compute arithmetic', async () => {
    const headers = await authHeaders('calc@example.com');
    mockStreamChatCompletion
      .mockImplementationOnce(async function* () {
        yield {
          type: 'tool_calls',
          toolCalls: [{ id: 'call_3', name: 'calculate', arguments: '{"expression":"6 * 7"}' }],
        };
      })
      .mockImplementationOnce(async function* () {
        yield { type: 'content', content: '42' };
      });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/chat',
      headers,
      payload: { message: 'what is 6 times 7' },
    });

    const events = parseEvents(response);
    const toolResult = events.find((event) => event.type === 'tool_result');
    expect(toolResult).toMatchObject({ name: 'calculate', ok: true, output: '42' });
    const done = events[events.length - 1]!;
    expect(done.message?.content).toBe('42');
  });

  it('stops after the maximum number of tool rounds', async () => {
    const headers = await authHeaders('loop@example.com');
    mockStreamChatCompletion.mockImplementation(async function* () {
      yield {
        type: 'tool_calls',
        toolCalls: [{ id: 'call_x', name: 'echo', arguments: '{"text":"x"}' }],
      };
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/chat',
      headers,
      payload: { message: 'loop forever' },
    });

    expect(response.statusCode).toBe(200);
    const events = parseEvents(response);
    expect(events[events.length - 1]!.type).toBe('done');
    expect(events.filter((event) => event.type === 'tool_start')).toHaveLength(5);
    expect(mockStreamChatCompletion).toHaveBeenCalledTimes(6);
  });
});

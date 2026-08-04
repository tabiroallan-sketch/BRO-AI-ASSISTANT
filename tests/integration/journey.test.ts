import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

process.env.DATABASE_URL = '';
process.env.REDIS_URL = '';
process.env.JWT_SECRET = 'journey-test-access-secret';
process.env.JWT_REFRESH_SECRET = 'journey-test-refresh-secret';
process.env.JWT_EXPIRES_IN = '15m';
process.env.JWT_REFRESH_EXPIRES_IN = '7d';

const { mockAiConfigured, mockStreamChatCompletion } = vi.hoisted(() => ({
  mockAiConfigured: vi.fn<() => boolean>(),
  mockStreamChatCompletion:
    vi.fn<(messages: unknown[], tools?: unknown[]) => AsyncGenerator<Record<string, unknown>>>(),
}));

vi.mock('../../src/lib/ai.js', () => ({
  aiConfigured: mockAiConfigured,
  streamChatCompletion: mockStreamChatCompletion,
}));

vi.mock('../../src/lib/prisma.js', async () => {
  const { getMockDb } = await import('../helpers/mock-db.js');
  return { prisma: getMockDb().mockPrisma };
});

type MockDbModule = typeof import('../helpers/mock-db.js');

function parseSse(payload: string): Array<Record<string, unknown>> {
  return payload
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => JSON.parse(line.slice(6)) as Record<string, unknown>);
}

describe('full user journey', () => {
  let app: FastifyInstance;
  let db: MockDbModule['MockDb'];

  beforeAll(async () => {
    const [{ buildApp }, mockDb] = await Promise.all([
      import('../../src/app.js'),
      import('../helpers/mock-db.js'),
    ]);
    db = mockDb.getMockDb();
    app = buildApp();
    mockAiConfigured.mockReturnValue(true);
    mockStreamChatCompletion.mockImplementation(async function* () {
      yield { type: 'content', content: 'Hello from BRO' };
    });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    db.resetDb();
  });

  it('completes register → chat → memory → analytics → refresh → logout', async () => {
    const registered = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: 'journey@example.com',
        password: 'strong-password-123',
        displayName: 'Journey',
      },
    });
    expect(registered.statusCode).toBe(201);
    const account = registered.json();
    expect(account.user.email).toBe('journey@example.com');
    let accessToken: string = account.accessToken;
    let refreshToken: string = account.refreshToken;

    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(me.statusCode).toBe(200);
    const userId: string = me.json().user.id;

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/conversations',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { title: 'Trip planning' },
    });
    expect(created.statusCode).toBe(201);
    const conversationId: string = created.json().conversation.id;

    const chat = await app.inject({
      method: 'POST',
      url: '/api/v1/chat',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { conversationId, message: 'Remember that I like coffee' },
    });
    expect(chat.statusCode).toBe(200);
    expect(chat.headers['content-type']).toContain('text/event-stream');
    const events = parseSse(chat.payload);
    const eventTypes = events.map((event) => event.type);
    expect(eventTypes[0]).toBe('start');
    expect(eventTypes).toContain('delta');
    expect(eventTypes[eventTypes.length - 1]).toBe('done');
    const doneEvent = events.find((event) => event.type === 'done') as {
      message: { content: string };
    };
    expect(doneEvent.message.content).toBe('Hello from BRO');

    const listed = await app.inject({
      method: 'GET',
      url: '/api/v1/conversations',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(listed.statusCode).toBe(200);
    const summary = listed
      .json()
      .conversations.find((entry: { id: string }) => entry.id === conversationId);
    expect(summary).toBeDefined();
    expect(summary.messageCount).toBe(2);

    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/conversations/${conversationId}`,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(detail.statusCode).toBe(200);
    const roles = detail
      .json()
      .conversation.messages.map((message: { role: string }) => message.role);
    expect(roles).toEqual(['USER', 'ASSISTANT']);

    const memory = await app.inject({
      method: 'POST',
      url: '/api/v1/memories',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { key: 'preference', value: 'likes coffee' },
    });
    expect(memory.statusCode).toBe(201);
    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/v1/memories',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { key: 'preference', value: 'likes strong coffee' },
    });
    expect(duplicate.statusCode).toBe(200);

    const memories = await app.inject({
      method: 'GET',
      url: '/api/v1/memories',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(memories.json().memories).toHaveLength(1);

    db.seedNotification(userId, 'Welcome', 'You joined');
    const notifications = await app.inject({
      method: 'GET',
      url: '/api/v1/notifications',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(notifications.statusCode).toBe(200);
    expect(notifications.json().notifications).toHaveLength(1);
    expect(notifications.json().unreadCount).toBe(1);

    const analytics = await app.inject({
      method: 'GET',
      url: '/api/v1/analytics',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(analytics.statusCode).toBe(200);
    expect(analytics.json().totals).toMatchObject({ conversations: 1, memories: 1, messages: 2 });
    expect(analytics.json().daily).toHaveLength(14);

    const refreshed = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken },
    });
    expect(refreshed.statusCode).toBe(200);
    const rotated = refreshed.json();
    accessToken = rotated.accessToken;
    expect(rotated.refreshToken).not.toBe(refreshToken);
    refreshToken = rotated.refreshToken;

    const meAfterRefresh = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(meAfterRefresh.statusCode).toBe(200);

    const loggedOut = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      payload: { refreshToken },
    });
    expect(loggedOut.statusCode).toBe(204);

    const reuse = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken },
    });
    expect(reuse.statusCode).toBe(401);
  });
});

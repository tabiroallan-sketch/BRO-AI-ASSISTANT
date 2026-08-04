import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '../../src/generated/index.js';

process.env.JWT_SECRET = 'e2e-test-access-secret';
process.env.JWT_REFRESH_SECRET = 'e2e-test-refresh-secret';
process.env.JWT_EXPIRES_IN = '15m';
process.env.JWT_REFRESH_EXPIRES_IN = '7d';
process.env.ANALYTICS_CACHE_MS = '0';

const { mockAiConfigured, mockStreamChatCompletion } = vi.hoisted(() => ({
  mockAiConfigured: vi.fn<() => boolean>(),
  mockStreamChatCompletion:
    vi.fn<(messages: unknown[], tools?: unknown[]) => AsyncGenerator<Record<string, unknown>>>(),
}));

vi.mock('../../src/lib/ai.js', () => ({
  aiConfigured: mockAiConfigured,
  streamChatCompletion: mockStreamChatCompletion,
}));

function parseSse(payload: string): Array<Record<string, unknown>> {
  return payload
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => JSON.parse(line.slice(6)) as Record<string, unknown>);
}

const email = `e2e-${Date.now()}@example.com`;

describe.runIf(process.env.TEST_E2E === '1')('end-to-end flow against a real database', () => {
  let app: FastifyInstance;
  let prisma: PrismaClient;
  let userId = '';
  let accessToken = '';
  let refreshToken = '';

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error('TEST_E2E requires DATABASE_URL to be set');
    }
    const [{ buildApp }, prismaModule] = await Promise.all([
      import('../../src/app.js'),
      import('../../src/lib/prisma.js'),
    ]);
    prisma = prismaModule.prisma as PrismaClient;
    if (!prisma) {
      throw new Error('TEST_E2E requires a reachable DATABASE_URL');
    }
    app = buildApp();
    mockAiConfigured.mockReturnValue(true);
    mockStreamChatCompletion.mockImplementation(async function* () {
      yield { type: 'content', content: 'Hello from E2E' };
    });
  });

  afterAll(async () => {
    if (prisma && userId) {
      await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
    }
    await app.close();
  });

  it('registers, logs in, chats, stores memories, and reads analytics', async () => {
    const registered = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email, password: 'e2e-password-123', displayName: 'E2E User' },
    });
    expect(registered.statusCode).toBe(201);
    const account = registered.json();
    userId = account.user.id;
    accessToken = account.accessToken;
    refreshToken = account.refreshToken;

    const loggedIn = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password: 'e2e-password-123' },
    });
    expect(loggedIn.statusCode).toBe(200);

    const chat = await app.inject({
      method: 'POST',
      url: '/api/v1/chat',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { message: 'Say hello' },
    });
    expect(chat.statusCode).toBe(200);
    const events = parseSse(chat.payload);
    expect(events[0]?.type).toBe('start');
    expect(events.map((event) => event.type)).toContain('delta');
    expect(events[events.length - 1]?.type).toBe('done');

    const conversations = await app.inject({
      method: 'GET',
      url: '/api/v1/conversations',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(conversations.statusCode).toBe(200);
    expect(conversations.json().conversations).toHaveLength(1);
    expect(conversations.json().conversations[0].messageCount).toBe(2);

    const memory = await app.inject({
      method: 'POST',
      url: '/api/v1/memories',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { key: 'name', value: 'E2E User' },
    });
    expect(memory.statusCode).toBe(201);

    const analytics = await app.inject({
      method: 'GET',
      url: '/api/v1/analytics',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(analytics.statusCode).toBe(200);
    expect(analytics.json().totals).toMatchObject({ conversations: 1, memories: 1, messages: 2 });

    const loggedOut = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      payload: { refreshToken },
    });
    expect(loggedOut.statusCode).toBe(204);
  });
});

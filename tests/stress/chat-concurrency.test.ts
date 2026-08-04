import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

process.env.DATABASE_URL = '';
process.env.REDIS_URL = '';
process.env.RATE_LIMIT_ENABLED = 'false';
process.env.JWT_SECRET = 'stress-chat-secret';
process.env.JWT_REFRESH_SECRET = 'stress-chat-refresh-secret';
process.env.JWT_EXPIRES_IN = '15m';

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

function parseSse(payload: string): Array<Record<string, unknown>> {
  return payload
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => JSON.parse(line.slice(6)) as Record<string, unknown>);
}

describe('concurrent chat requests', () => {
  let app: FastifyInstance;
  let db: import('../helpers/mock-db.js').MockDb;
  let token = '';

  beforeAll(async () => {
    const [{ buildApp }, mockDb] = await Promise.all([
      import('../../src/app.js'),
      import('../helpers/mock-db.js'),
    ]);
    db = mockDb.getMockDb();
    app = buildApp();
    mockAiConfigured.mockReturnValue(true);
    mockStreamChatCompletion.mockImplementation(async function* () {
      yield { type: 'content', content: 'Hello from stress' };
    });
    token = await db.registerAndLogin('stress-chat@example.com');
  });

  afterAll(async () => {
    await app.close();
  });

  it('handles 40 simultaneous chat streams without errors', async () => {
    const requests = 40;
    const responses = await Promise.all(
      Array.from({ length: requests }, (_, index) =>
        app.inject({
          method: 'POST',
          url: '/api/v1/chat',
          headers: { authorization: `Bearer ${token}` },
          payload: { message: `Concurrent message ${index}` },
        }),
      ),
    );

    for (const response of responses) {
      expect(response.statusCode).toBe(200);
      const events = parseSse(response.payload);
      expect(events.map((event) => event.type)).not.toContain('error');
      expect(events[0]?.type).toBe('start');
      expect(events.map((event) => event.type)).toContain('delta');
      expect(events[events.length - 1]?.type).toBe('done');
    }

    const state = db.state();
    expect(state.conversations).toBe(requests);
    expect(state.messages).toBe(requests * 2);
  });
});

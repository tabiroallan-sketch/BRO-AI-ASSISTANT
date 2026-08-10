import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

process.env.DATABASE_URL = '';
process.env.REDIS_URL = '';
process.env.JWT_SECRET = 'test-access-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
process.env.JWT_EXPIRES_IN = '15m';
process.env.JWT_REFRESH_EXPIRES_IN = '7d';

const { mockAiConfigured, mockTranscribe } = vi.hoisted(() => ({
  mockAiConfigured: vi.fn<() => boolean>(),
  mockTranscribe: vi.fn<(audio: string, format: string) => Promise<string>>(),
}));

vi.mock('../src/lib/ai.js', () => ({
  aiConfigured: mockAiConfigured,
  transcribeAudioChunk: mockTranscribe,
}));

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

const { mockPrisma, resetDb, registerAndLogin } = vi.hoisted(() => {
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
  };

  const sessionModel = {
    async create(args: {
      data: { userId: string; token: string; expiresAt: Date };
    }): Promise<MockSession> {
      const session: MockSession = {
        id: `session-${users.size}`,
        userId: args.data.userId,
        token: args.data.token,
        expiresAt: args.data.expiresAt,
        createdAt: new Date(),
        updatedAt: new Date(),
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
  };

  async function registerAndLogin(email: string): Promise<{ headers: { authorization: string } }> {
    const user: MockUser = {
      id: `user-${users.size}`,
      email,
      passwordHash: 'hash',
      displayName: null,
      avatarUrl: null,
      role: 'USER',
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    users.set(user.id, user);
    const session: MockSession = {
      id: `session-${users.size}`,
      userId: user.id,
      token: `token-${user.id}`,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    sessions.set(session.id, session);

    const { signAccessToken } = await import('../src/lib/jwt.js');
    const token = await signAccessToken(user.id, user.role);
    return { headers: { authorization: `Bearer ${token}` } };
  }

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
    registerAndLogin,
  };
});

vi.mock('../src/lib/prisma.js', () => ({ prisma: mockPrisma }));

describe('audio transcription', () => {
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
    mockAiConfigured.mockReset();
    mockTranscribe.mockReset();
    mockAiConfigured.mockReturnValue(true);
    mockTranscribe.mockResolvedValue('hello world');
  });

  it('requires authentication', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/audio/transcribe',
      payload: { audio: 'AAAA', format: 'wav' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('transcribes an audio chunk and returns the text', async () => {
    const session = await registerAndLogin('audio@example.com');
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/audio/transcribe',
      headers: session.headers,
      payload: { audio: 'QUlG', format: 'wav' },
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ text: 'hello world' });
    expect(mockTranscribe).toHaveBeenCalledWith('QUlG', 'wav');
  });

  it('defaults the format to wav', async () => {
    const session = await registerAndLogin('format@example.com');
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/audio/transcribe',
      headers: session.headers,
      payload: { audio: 'QUlG' },
    });
    expect(response.statusCode).toBe(200);
    expect(mockTranscribe).toHaveBeenCalledWith('QUlG', 'wav');
  });

  it('rejects an invalid request body with 400', async () => {
    const session = await registerAndLogin('bad@example.com');
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/audio/transcribe',
      headers: session.headers,
      payload: { audio: '', format: 'wav' },
    });
    expect(response.statusCode).toBe(400);
    expect(mockTranscribe).not.toHaveBeenCalled();
  });

  it('returns 503 when the AI provider is not configured', async () => {
    mockAiConfigured.mockReturnValue(false);
    const session = await registerAndLogin('unconfigured@example.com');
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/audio/transcribe',
      headers: session.headers,
      payload: { audio: 'QUlG', format: 'wav' },
    });
    expect(response.statusCode).toBe(503);
    expect(mockTranscribe).not.toHaveBeenCalled();
  });

  it('returns 502 when the provider call fails', async () => {
    mockTranscribe.mockRejectedValue(new Error('upstream failed'));
    const session = await registerAndLogin('fail@example.com');
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/audio/transcribe',
      headers: session.headers,
      payload: { audio: 'QUlG', format: 'wav' },
    });
    expect(response.statusCode).toBe(502);
  });
});

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

process.env.DATABASE_URL = '';
process.env.REDIS_URL = '';
process.env.JWT_SECRET = 'test-access-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
process.env.JWT_EXPIRES_IN = '15m';
process.env.JWT_REFRESH_EXPIRES_IN = '7d';

const { mockElevenConfigured, mockSynthesize } = vi.hoisted(() => ({
  mockElevenConfigured: vi.fn<() => boolean>(),
  mockSynthesize: vi.fn<(text: string) => Promise<Buffer | null>>(),
}));

vi.mock('../src/lib/tts.js', () => ({
  elevenLabsConfigured: mockElevenConfigured,
  synthesizeSpeech: mockSynthesize,
}));

vi.mock('../src/lib/ai.js', () => ({
  aiConfigured: vi.fn<() => boolean>(() => true),
  transcribeAudioChunk: vi.fn(),
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
      sessions.delete(args.where.id);
      return {} as MockSession;
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
    sessions.set(`session-${users.size}`, {
      id: `session-${users.size}`,
      userId: user.id,
      token: `token-${user.id}`,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

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

describe('speech synthesis (TTS) route', () => {
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
    mockElevenConfigured.mockReset();
    mockSynthesize.mockReset();
    mockElevenConfigured.mockReturnValue(true);
    mockSynthesize.mockResolvedValue(Buffer.from('MP3-DATA', 'binary'));
  });

  it('requires authentication', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/audio/speak?text=hello',
    });
    expect(response.statusCode).toBe(401);
  });

  it('synthesizes speech and returns audio/mpeg', async () => {
    const session = await registerAndLogin('speak@example.com');
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/audio/speak?text=Hello%20world',
      headers: session.headers,
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('audio/mpeg');
    expect(mockSynthesize).toHaveBeenCalledWith('Hello world');
  });

  it('returns 400 for missing text', async () => {
    const session = await registerAndLogin('speak-bad@example.com');
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/audio/speak',
      headers: session.headers,
    });
    expect(response.statusCode).toBe(400);
    expect(mockSynthesize).not.toHaveBeenCalled();
  });

  it('returns 503 when ElevenLabs is not configured', async () => {
    mockElevenConfigured.mockReturnValue(false);
    const session = await registerAndLogin('speak-un@example.com');
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/audio/speak?text=hi',
      headers: session.headers,
    });
    expect(response.statusCode).toBe(503);
    expect(mockSynthesize).not.toHaveBeenCalled();
  });

  it('returns 502 when synthesis fails upstream', async () => {
    mockSynthesize.mockRejectedValue(new Error('upstream failed'));
    const session = await registerAndLogin('speak-fail@example.com');
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/audio/speak?text=hi',
      headers: session.headers,
    });
    expect(response.statusCode).toBe(502);
  });
});

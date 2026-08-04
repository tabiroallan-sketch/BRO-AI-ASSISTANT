import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

process.env.DATABASE_URL = '';
process.env.REDIS_URL = '';
process.env.RATE_LIMIT_ENABLED = 'false';
process.env.JWT_SECRET = 'stress-auth-secret';
process.env.JWT_REFRESH_SECRET = 'stress-auth-refresh-secret';
process.env.JWT_EXPIRES_IN = '15m';
process.env.JWT_REFRESH_EXPIRES_IN = '7d';

vi.mock('../../src/lib/prisma.js', async () => {
  const { getMockDb } = await import('../helpers/mock-db.js');
  return { prisma: getMockDb().mockPrisma };
});

describe('concurrent registration and login', () => {
  let app: FastifyInstance;
  let db: import('../helpers/mock-db.js').MockDb;

  beforeAll(async () => {
    const [{ buildApp }, mockDb] = await Promise.all([
      import('../../src/app.js'),
      import('../helpers/mock-db.js'),
    ]);
    db = mockDb.getMockDb();
    app = buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('registers 30 users concurrently', async () => {
    const accounts = 30;
    const responses = await Promise.all(
      Array.from({ length: accounts }, (_, index) =>
        app.inject({
          method: 'POST',
          url: '/api/v1/auth/register',
          payload: {
            email: `stress-auth-${index}@example.com`,
            password: 'stress-password-123',
          },
        }),
      ),
    );
    for (const response of responses) {
      expect(response.statusCode).toBe(201);
    }
    expect(db.state().users).toBe(accounts);
  });

  it('logs in the same 30 users concurrently', async () => {
    const responses = await Promise.all(
      Array.from({ length: 30 }, (_, index) =>
        app.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          payload: {
            email: `stress-auth-${index}@example.com`,
            password: 'stress-password-123',
          },
        }),
      ),
    );
    for (const response of responses) {
      expect(response.statusCode).toBe(200);
      expect(response.json().accessToken).toBeDefined();
    }
  });
});

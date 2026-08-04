import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

process.env.DATABASE_URL = '';
process.env.REDIS_URL = '';
process.env.RATE_LIMIT_ENABLED = 'false';
process.env.JWT_SECRET = 'stress-health-secret';
process.env.JWT_REFRESH_SECRET = 'stress-health-refresh-secret';

vi.mock('../../src/lib/prisma.js', () => ({ prisma: null }));

describe('concurrent health checks', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { buildApp } = await import('../../src/app.js');
    app = buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves 200 simultaneous health requests', async () => {
    const requests = 200;
    const responses = await Promise.all(
      Array.from({ length: requests }, () => app.inject({ method: 'GET', url: '/health' })),
    );
    for (const response of responses) {
      expect(response.statusCode).toBe(200);
      expect(response.json().status).toBe('ok');
    }
  });
});

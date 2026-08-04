import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

process.env.DATABASE_URL = '';
process.env.REDIS_URL = '';
process.env.RATE_LIMIT_ENABLED = 'false';
process.env.JWT_SECRET = 'perf-test-access-secret';
process.env.JWT_REFRESH_SECRET = 'perf-test-refresh-secret';

vi.mock('../../src/lib/prisma.js', () => ({ prisma: null }));

describe('HTTP request throughput', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { buildApp } = await import('../../src/app.js');
    app = buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves 300 health requests quickly', { retry: 2 }, async () => {
    const count = 300;
    const start = performance.now();
    for (let index = 0; index < count; index += 1) {
      const response = await app.inject({ method: 'GET', url: '/health' });
      expect(response.statusCode).toBe(200);
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(10_000);
  });
});

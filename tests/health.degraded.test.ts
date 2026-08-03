import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

process.env.DATABASE_URL = 'postgresql://user:pass@127.0.0.1:59999/bro';
process.env.REDIS_URL = 'redis://127.0.0.1:59998';

describe('GET /health when services are unreachable', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { buildApp } = await import('../src/app.js');
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 503 with error database and redis checks', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(503);
    expect(body.status).toBe('degraded');
    expect(body.checks.application.status).toBe('ok');
    expect(body.checks.database.status).toBe('error');
    expect(body.checks.redis.status).toBe('error');
    expect(typeof body.checks.database.error).toBe('string');
  }, 15000);
});

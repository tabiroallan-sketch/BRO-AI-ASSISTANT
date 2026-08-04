import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

process.env.DATABASE_URL = '';
process.env.REDIS_URL = '';
process.env.JWT_SECRET = 'integration-test-secret';
process.env.JWT_REFRESH_SECRET = 'integration-test-refresh-secret';
process.env.NODE_ENV = 'development';

vi.mock('../../src/lib/prisma.js', () => ({ prisma: null }));

describe('app scaffolding', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { buildApp } = await import('../../src/app.js');
    app = buildApp();
    app.get('/boom', async () => {
      throw new Error('kaboom');
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('reports health with disabled database and redis', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe('ok');
    expect(body.checks.database).toEqual({ status: 'disabled' });
    expect(body.checks.redis).toEqual({ status: 'disabled' });
    expect(body.checks.application).toEqual({ status: 'ok' });
  });

  it('serves Swagger UI and OpenAPI JSON', async () => {
    const ui = await app.inject({ method: 'GET', url: '/docs' });
    expect(ui.statusCode).toBe(200);
    const spec = await app.inject({ method: 'GET', url: '/docs/json' });
    expect(spec.statusCode).toBe(200);
    expect(spec.json().openapi).toBe('3.0.3');
  });

  it('applies CORS headers to preflight requests', async () => {
    const response = await app.inject({
      method: 'OPTIONS',
      url: '/api/v1/auth/register',
      headers: {
        origin: 'http://localhost:3001',
        'access-control-request-method': 'POST',
      },
    });
    expect(response.statusCode).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:3001');
    expect(response.headers['access-control-allow-methods']).toContain('POST');
  });

  it('sends security headers via helmet', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.headers['x-frame-options']).toBe('DENY');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
  });

  it('returns a JSON 404 for unknown routes', async () => {
    const response = await app.inject({ method: 'GET', url: '/definitely/not/here' });
    expect(response.statusCode).toBe(404);
    expect(response.json().error).toBeDefined();
  });

  it('rejects overlong request URLs with 414', async () => {
    const longUrl = `/health?${'a'.repeat(3000)}`;
    const response = await app.inject({ method: 'GET', url: longUrl });
    expect(response.statusCode).toBe(414);
    expect(response.json().error.message).toMatch(/too long/i);
  });

  it('rejects oversized bodies with 413', async () => {
    const huge = 'x'.repeat(2 * 1024 * 1024);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'a@b.com', password: huge },
    });
    expect(response.statusCode).toBe(413);
  });

  it('shapes 500 errors without leaking internals', async () => {
    const response = await app.inject({ method: 'GET', url: '/boom' });
    expect(response.statusCode).toBe(500);
    const body = response.json();
    expect(body.error.code).toBe(500);
    expect(body.error.message).toBe('Internal Server Error');
  });

  it('returns 401 for protected routes without a token', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/conversations' });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.message).toMatch(/authorization/i);
  });
});

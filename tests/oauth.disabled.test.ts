import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

process.env.DATABASE_URL = '';
process.env.REDIS_URL = '';
process.env.GOOGLE_CLIENT_ID = '';
process.env.GOOGLE_CLIENT_SECRET = '';
process.env.GOOGLE_REDIRECT_URI = '';

describe('Google OAuth when not configured', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { buildApp } = await import('../src/app.js');
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('reports only the email provider', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/auth/providers' });
    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(200);
    expect(body.providers.map((p: { id: string }) => p.id)).toEqual(['email']);
  });

  it('returns 503 when starting Google auth', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/auth/google' });

    expect(response.statusCode).toBe(503);
  });

  it('returns 503 on the callback when not configured', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/google/callback?code=x',
    });

    expect(response.statusCode).toBe(503);
  });
});

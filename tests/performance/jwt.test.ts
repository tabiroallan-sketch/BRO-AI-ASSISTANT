import { describe, expect, it, beforeAll } from 'vitest';

process.env.JWT_SECRET = 'perf-test-access-secret';
process.env.JWT_REFRESH_SECRET = 'perf-test-refresh-secret';
process.env.JWT_EXPIRES_IN = '15m';

type JwtModule = typeof import('../../src/lib/jwt.js');

describe('JWT throughput', () => {
  let jwt: JwtModule;

  beforeAll(async () => {
    jwt = await import('../../src/lib/jwt.js');
  });

  it('signs and verifies 500 tokens quickly', { retry: 2 }, async () => {
    const count = 500;
    const start = performance.now();
    const tokens: string[] = [];
    for (let index = 0; index < count; index += 1) {
      tokens.push(await jwt.signAccessToken(`user-${index}`, 'USER'));
    }
    for (const token of tokens) {
      await jwt.verifyAccessToken(token);
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(5000);
  });

  it('generates and hashes 5k refresh tokens quickly', { retry: 2 }, () => {
    const count = 5_000;
    const start = performance.now();
    for (let index = 0; index < count; index += 1) {
      const token = jwt.generateRefreshToken();
      jwt.hashRefreshToken(token);
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(2000);
  });
});

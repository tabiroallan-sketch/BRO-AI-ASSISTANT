import { describe, expect, it, beforeAll } from 'vitest';
import { SignJWT } from 'jose';

process.env.JWT_SECRET = 'unit-test-access-secret';
process.env.JWT_REFRESH_SECRET = 'unit-test-refresh-secret';
process.env.JWT_EXPIRES_IN = '1h';
process.env.JWT_REFRESH_EXPIRES_IN = '7d';

type JwtModule = typeof import('../../src/lib/jwt.js');

describe('JWT helpers', () => {
  let jwt: JwtModule;

  beforeAll(async () => {
    jwt = await import('../../src/lib/jwt.js');
  });

  it('signs and verifies an access token round trip', async () => {
    const token = await jwt.signAccessToken('user-1', 'ADMIN');
    const payload = await jwt.verifyAccessToken(token);
    expect(payload.sub).toBe('user-1');
    expect(payload.role).toBe('ADMIN');
    expect(payload.exp).toBeGreaterThan(0);
  });

  it('rejects tokens signed with a different secret', async () => {
    const encoder = new TextEncoder();
    const foreign = await new SignJWT({ role: 'USER' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('user-2')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(encoder.encode('some-other-secret'));
    await expect(jwt.verifyAccessToken(foreign)).rejects.toThrow();
  });

  it('rejects tokens signed with an unapproved algorithm', async () => {
    const encoder = new TextEncoder();
    const foreign = await new SignJWT({ role: 'USER' })
      .setProtectedHeader({ alg: 'HS512' })
      .setSubject('user-3')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(encoder.encode(process.env.JWT_SECRET ?? ''));
    await expect(jwt.verifyAccessToken(foreign)).rejects.toThrow();
  });

  it('rejects expired tokens', async () => {
    const encoder = new TextEncoder();
    const expired = await new SignJWT({ role: 'USER' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('user-4')
      .setIssuedAt()
      .setExpirationTime(-1000)
      .sign(encoder.encode(process.env.JWT_SECRET ?? ''));
    await expect(jwt.verifyAccessToken(expired)).rejects.toThrow();
  });

  it('generates unique base64url refresh tokens', () => {
    const tokens = new Set(Array.from({ length: 100 }, () => jwt.generateRefreshToken()));
    expect(tokens.size).toBe(100);
    for (const token of tokens) {
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    }
  });

  it('hashes refresh tokens deterministically', () => {
    const token = 'some-refresh-token-value';
    const first = jwt.hashRefreshToken(token);
    const second = jwt.hashRefreshToken(token);
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(first).not.toBe(token);
  });

  it('derives the refresh token TTL from configuration', () => {
    expect(jwt.refreshTokenTtlSeconds()).toBe(7 * 24 * 60 * 60);
  });

  it('computes a refresh token expiry in the future', () => {
    const expiry = jwt.refreshTokenExpiry();
    const now = Date.now();
    expect(expiry.getTime()).toBeGreaterThan(now);
    expect(expiry.getTime()).toBeLessThan(now + 7 * 24 * 60 * 60 * 1000 + 1000);
  });
});

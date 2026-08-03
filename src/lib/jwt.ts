import { createHash, randomBytes } from 'node:crypto';
import { jwtVerify, SignJWT } from 'jose';
import { config } from '../config/index.js';

const ALGORITHM = 'HS256';

export type AccessTokenPayload = {
  sub: string;
  role: string;
  iat: number;
  exp: number;
};

const encoder = new TextEncoder();

export function signAccessToken(userId: string, role: string): Promise<string> {
  return new SignJWT({ role })
    .setProtectedHeader({ alg: ALGORITHM })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(config.jwtExpiresIn)
    .sign(encoder.encode(config.jwtSecret));
}

export async function verifyAccessToken(token: string): Promise<AccessTokenPayload> {
  const { payload } = await jwtVerify(token, encoder.encode(config.jwtSecret), {
    algorithms: [ALGORITHM],
  });
  return {
    sub: String(payload.sub),
    role: String(payload.role ?? ''),
    iat: payload.iat ?? 0,
    exp: payload.exp ?? 0,
  };
}

export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function refreshTokenTtlSeconds(): number {
  return ttlToSeconds(config.jwtRefreshExpiresIn);
}

export function refreshTokenExpiry(): Date {
  return new Date(Date.now() + refreshTokenTtlSeconds() * 1000);
}

function ttlToSeconds(ttl: string): number {
  const match = /^(\d+)([smhd])$/.exec(ttl.trim());
  if (!match) {
    return 7 * 24 * 60 * 60;
  }
  const value = parseInt(match[1] ?? '0', 10);
  const unit = match[2] ?? 'd';
  switch (unit) {
    case 's':
      return value;
    case 'm':
      return value * 60;
    case 'h':
      return value * 60 * 60;
    case 'd':
      return value * 24 * 60 * 60;
    default:
      return 7 * 24 * 60 * 60;
  }
}

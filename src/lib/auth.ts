import type { FastifyReply, FastifyRequest } from 'fastify';
import { verifyAccessToken } from './jwt.js';
import type { GoogleProfile, GoogleTokenResponse } from './oauth.js';
import { prisma } from './prisma.js';
import { cacheDelete, cacheGet, cacheSet } from './cache.js';
import { encryptValue } from './encryption.js';
import { config } from '../config/index.js';

export class HttpError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
  }
}

export type AuthUser = {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  role: 'USER' | 'ADMIN';
  isActive: boolean;
};

export type Role = AuthUser['role'];

export function requireRole(...roles: Role[]): (request: FastifyRequest) => Promise<void> {
  return async (request: FastifyRequest) => {
    if (!request.user) {
      throw new HttpError(401, 'Unauthorized');
    }
    if (!roles.includes(request.user.role)) {
      throw new HttpError(403, 'Forbidden: insufficient permissions');
    }
  };
}

const AUTH_USER_SELECT = {
  id: true,
  email: true,
  displayName: true,
  avatarUrl: true,
  role: true,
  isActive: true,
  googleId: true,
} as const;

const authUserCacheKey = (userId: string): string => `authuser:${userId}`;

export function invalidateCachedUser(userId: string): void {
  cacheDelete(authUserCacheKey(userId));
}

export async function requireAuth(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const header = request.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    throw new HttpError(401, 'Missing or invalid authorization header');
  }

  let payload;
  try {
    payload = await verifyAccessToken(header.slice('Bearer '.length));
  } catch {
    throw new HttpError(401, 'Invalid or expired access token');
  }

  if (config.authUserCacheMs > 0) {
    const cachedUser = cacheGet<AuthUser>(authUserCacheKey(payload.sub));
    if (cachedUser) {
      if (!cachedUser.isActive) {
        throw new HttpError(401, 'Account not found or disabled');
      }
      request.user = cachedUser;
      return;
    }
  }

  if (!prisma) {
    throw new HttpError(503, 'Database not configured');
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: AUTH_USER_SELECT,
  });

  if (!user || !user.isActive) {
    throw new HttpError(401, 'Account not found or disabled');
  }

  if (config.authUserCacheMs > 0) {
    cacheSet(authUserCacheKey(payload.sub), user, config.authUserCacheMs);
  }

  request.user = user;
}

export async function upsertGoogleUser(
  profile: GoogleProfile,
  tokens: GoogleTokenResponse,
): Promise<AuthUser> {
  if (!prisma) {
    throw new HttpError(503, 'Database not configured');
  }

  const existingAccount = await prisma.account.findUnique({
    where: {
      provider_providerAccountId: {
        provider: 'google',
        providerAccountId: profile.sub,
      },
    },
  });

  if (existingAccount) {
    await prisma.account.update({
      where: { id: existingAccount.id },
      data: {
        accessToken: encryptValue(tokens.access_token),
        refreshToken: tokens.refresh_token ? encryptValue(tokens.refresh_token) : null,
        expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
      },
    });
    const user = await prisma.user.findUnique({
      where: { id: existingAccount.userId },
      select: AUTH_USER_SELECT,
    });
    if (!user) {
      throw new HttpError(401, 'Account not found');
    }
    return user;
  }

  let user = profile.email
    ? await prisma.user.findUnique({ where: { email: profile.email }, select: AUTH_USER_SELECT })
    : null;

  if (!user) {
    user = await prisma.user.create({
      data: {
        email: profile.email,
        displayName: profile.name,
        avatarUrl: profile.picture,
        googleId: profile.sub,
      },
      select: AUTH_USER_SELECT,
    });
  } else if (!user.googleId) {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        googleId: profile.sub,
        ...(profile.picture && !user.avatarUrl ? { avatarUrl: profile.picture } : {}),
      },
    });
  }

  await prisma.account.create({
    data: {
      userId: user.id,
      provider: 'google',
      providerAccountId: profile.sub,
      accessToken: encryptValue(tokens.access_token),
      refreshToken: tokens.refresh_token ? encryptValue(tokens.refresh_token) : null,
      expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
    },
  });

  return user;
}

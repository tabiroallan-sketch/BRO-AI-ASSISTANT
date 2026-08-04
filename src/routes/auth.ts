import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { config } from '../config/index.js';
import { HttpError, requireAuth, upsertGoogleUser, type AuthUser, type Role } from '../lib/auth.js';
import { recordAudit } from '../lib/audit.js';
import {
  generateRefreshToken,
  hashRefreshToken,
  refreshTokenExpiry,
  signAccessToken,
} from '../lib/jwt.js';
import {
  buildGoogleAuthorizationUrl,
  exchangeGoogleCode,
  fetchGoogleProfile,
  googleOAuthEnabled,
} from '../lib/oauth.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { prisma } from '../lib/prisma.js';

const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
  password: z.string().min(8).max(128),
  displayName: z.string().trim().min(1).max(100).optional(),
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
  password: z.string().min(1).max(128),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

const AUTH_RATE_LIMIT = { max: 20, windowMs: 60_000 } as const;

async function createSession(userId: string): Promise<string> {
  if (!prisma) {
    throw new HttpError(503, 'Database not configured');
  }
  const token = generateRefreshToken();
  await prisma.session.create({
    data: {
      userId,
      token: hashRefreshToken(token),
      expiresAt: refreshTokenExpiry(),
    },
  });
  return token;
}

function publicUser(user: AuthUser): {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  role: 'USER' | 'ADMIN';
} {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    role: user.role,
  };
}

function auditContext(request: FastifyRequest): { ip?: string; userAgent?: string } {
  return {
    ip: request.ip,
    userAgent: request.headers['user-agent'],
  };
}

async function ensureAdminRole(user: AuthUser): Promise<AuthUser> {
  if (config.adminEmails.includes(user.email) && user.role !== 'ADMIN') {
    if (!prisma) {
      return user;
    }
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { role: 'ADMIN' as Role },
      select: {
        id: true,
        email: true,
        displayName: true,
        avatarUrl: true,
        role: true,
        isActive: true,
      },
    });
    return updated;
  }
  return user;
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/auth/register', { config: { rateLimit: AUTH_RATE_LIMIT } }, async (request, reply) => {
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new HttpError(400, 'Invalid request body');
    }
    const { email, password, displayName } = parsed.data;

    if (!prisma) {
      throw new HttpError(503, 'Database not configured');
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new HttpError(409, 'Email already registered');
    }

    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: await hashPassword(password),
        displayName,
        role: config.adminEmails.includes(email) ? 'ADMIN' : undefined,
      },
      select: {
        id: true,
        email: true,
        displayName: true,
        avatarUrl: true,
        role: true,
        isActive: true,
      },
    });

    const [accessToken, refreshToken] = await Promise.all([
      signAccessToken(user.id, user.role),
      createSession(user.id),
    ]);

    recordAudit({
      actorId: user.id,
      actorEmail: user.email,
      action: 'auth.register',
      ...auditContext(request),
    });

    return reply.status(201).send({ accessToken, refreshToken, user: publicUser(user) });
  });

  app.post('/auth/login', { config: { rateLimit: AUTH_RATE_LIMIT } }, async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new HttpError(400, 'Invalid request body');
    }
    const { email, password } = parsed.data;

    if (!prisma) {
      throw new HttpError(503, 'Database not configured');
    }

    const found = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        displayName: true,
        avatarUrl: true,
        role: true,
        isActive: true,
        passwordHash: true,
      },
    });

    const passwordOk = found?.passwordHash
      ? await verifyPassword(password, found.passwordHash)
      : false;
    if (!found || !passwordOk) {
      recordAudit({
        action: 'auth.login',
        detail: `Failed login for ${email}`,
        ...auditContext(request),
      });
      throw new HttpError(401, 'Invalid email or password');
    }
    if (!found.isActive) {
      throw new HttpError(403, 'Account disabled');
    }

    const user = await ensureAdminRole(found);

    const [accessToken, refreshToken] = await Promise.all([
      signAccessToken(user.id, user.role),
      createSession(user.id),
    ]);

    recordAudit({
      actorId: user.id,
      actorEmail: user.email,
      action: 'auth.login',
      ...auditContext(request),
    });

    return reply.send({ accessToken, refreshToken, user: publicUser(user) });
  });

  app.post('/auth/refresh', async (request, reply) => {
    const parsed = refreshSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new HttpError(400, 'Invalid request body');
    }
    const { refreshToken } = parsed.data;

    if (!prisma) {
      throw new HttpError(503, 'Database not configured');
    }

    const session = await prisma.session.findFirst({
      where: { token: hashRefreshToken(refreshToken) },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            displayName: true,
            avatarUrl: true,
            role: true,
            isActive: true,
          },
        },
      },
    });

    if (!session || session.expiresAt < new Date()) {
      throw new HttpError(401, 'Invalid or expired refresh token');
    }
    if (!session.user.isActive) {
      throw new HttpError(401, 'Account disabled');
    }

    await prisma.session.delete({ where: { id: session.id } });

    const user = await ensureAdminRole(session.user);

    const [accessToken, newRefreshToken] = await Promise.all([
      signAccessToken(user.id, user.role),
      createSession(user.id),
    ]);

    recordAudit({
      actorId: user.id,
      actorEmail: user.email,
      action: 'auth.refresh',
      ...auditContext(request),
    });

    return reply.send({
      accessToken,
      refreshToken: newRefreshToken,
      user: publicUser(user),
    });
  });

  app.post('/auth/logout', async (request, reply) => {
    const parsed = refreshSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new HttpError(400, 'Invalid request body');
    }
    const { refreshToken } = parsed.data;

    if (!prisma) {
      throw new HttpError(503, 'Database not configured');
    }

    await prisma.session.deleteMany({ where: { token: hashRefreshToken(refreshToken) } });
    recordAudit({
      action: 'auth.logout',
      ...auditContext(request),
    });
    return reply.status(204).send();
  });

  app.get('/auth/providers', async () => {
    return {
      providers: [
        { id: 'email', label: 'Email & password' },
        ...(googleOAuthEnabled() ? [{ id: 'google', label: 'Google' }] : []),
      ],
    };
  });

  app.get('/auth/google', async (_request, reply) => {
    if (!googleOAuthEnabled()) {
      throw new HttpError(503, 'Google OAuth is not configured');
    }
    const state = randomBytes(16).toString('base64url');
    reply.setCookie('oauth_state', state, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: config.nodeEnv === 'production',
      maxAge: 600,
    });
    return reply.redirect(buildGoogleAuthorizationUrl(state));
  });

  app.get('/auth/google/callback', async (request, reply) => {
    if (!googleOAuthEnabled()) {
      throw new HttpError(503, 'Google OAuth is not configured');
    }

    const { code, state } = request.query as { code?: string; state?: string };
    if (!code) {
      throw new HttpError(400, 'Missing authorization code');
    }

    const expectedState = request.cookies?.oauth_state;
    reply.clearCookie('oauth_state', { path: '/' });
    if (!expectedState || !state || state !== expectedState) {
      throw new HttpError(400, 'Invalid OAuth state');
    }

    let tokens;
    try {
      tokens = await exchangeGoogleCode(code);
    } catch (error) {
      request.log.error({ err: error }, 'Google token exchange failed');
      throw new HttpError(502, 'Failed to exchange authorization code');
    }

    let profile;
    try {
      profile = await fetchGoogleProfile(tokens.access_token);
    } catch (error) {
      request.log.error({ err: error }, 'Google profile fetch failed');
      throw new HttpError(502, 'Failed to fetch Google profile');
    }

    if (!profile.email) {
      throw new HttpError(400, 'Google account has no email address');
    }

    const user = await ensureAdminRole(await upsertGoogleUser(profile, tokens));
    if (!user.isActive) {
      throw new HttpError(403, 'Account disabled');
    }

    const [accessToken, refreshToken] = await Promise.all([
      signAccessToken(user.id, user.role),
      createSession(user.id),
    ]);

    recordAudit({
      actorId: user.id,
      actorEmail: user.email,
      action: 'auth.oauth',
      detail: 'Google sign-in',
      ...auditContext(request),
    });

    const webOrigin = config.corsOrigin;
    return reply.redirect(
      `${webOrigin}/auth/callback#access_token=${encodeURIComponent(accessToken)}` +
        `&refresh_token=${encodeURIComponent(refreshToken)}`,
    );
  });

  app.get('/auth/me', { preHandler: requireAuth }, async (request) => {
    if (!request.user) {
      throw new HttpError(401, 'Unauthorized');
    }
    return { user: publicUser(request.user) };
  });
}

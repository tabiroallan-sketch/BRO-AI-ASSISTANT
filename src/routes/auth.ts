import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { HttpError, requireAuth, type AuthUser } from '../lib/auth.js';
import {
  generateRefreshToken,
  hashRefreshToken,
  refreshTokenExpiry,
  signAccessToken,
} from '../lib/jwt.js';
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

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/auth/register', async (request, reply) => {
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

    return reply.status(201).send({ accessToken, refreshToken, user: publicUser(user) });
  });

  app.post('/auth/login', async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new HttpError(400, 'Invalid request body');
    }
    const { email, password } = parsed.data;

    if (!prisma) {
      throw new HttpError(503, 'Database not configured');
    }

    const user = await prisma.user.findUnique({
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

    const passwordOk = user?.passwordHash
      ? await verifyPassword(password, user.passwordHash)
      : false;
    if (!user || !passwordOk) {
      throw new HttpError(401, 'Invalid email or password');
    }
    if (!user.isActive) {
      throw new HttpError(403, 'Account disabled');
    }

    const [accessToken, refreshToken] = await Promise.all([
      signAccessToken(user.id, user.role),
      createSession(user.id),
    ]);

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

    const [accessToken, newRefreshToken] = await Promise.all([
      signAccessToken(session.user.id, session.user.role),
      createSession(session.userId),
    ]);

    return reply.send({
      accessToken,
      refreshToken: newRefreshToken,
      user: publicUser(session.user),
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
    return reply.status(204).send();
  });

  app.get('/auth/me', { preHandler: requireAuth }, async (request) => {
    if (!request.user) {
      throw new HttpError(401, 'Unauthorized');
    }
    return { user: publicUser(request.user) };
  });
}

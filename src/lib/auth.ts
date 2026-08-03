import type { FastifyReply, FastifyRequest } from 'fastify';
import { verifyAccessToken } from './jwt.js';
import { prisma } from './prisma.js';

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

  if (!prisma) {
    throw new HttpError(503, 'Database not configured');
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: {
      id: true,
      email: true,
      displayName: true,
      avatarUrl: true,
      role: true,
      isActive: true,
    },
  });

  if (!user || !user.isActive) {
    throw new HttpError(401, 'Account not found or disabled');
  }

  request.user = user;
}

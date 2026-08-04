import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  HttpError,
  invalidateCachedUser,
  requireAuth,
  requireRole,
  type Role,
} from '../lib/auth.js';
import { getAuditLogs, recordAudit } from '../lib/audit.js';
import { prisma } from '../lib/prisma.js';

const updateUserSchema = z
  .object({
    role: z.enum(['USER', 'ADMIN']).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((value) => value.role !== undefined || value.isActive !== undefined, {
    message: 'Provide role and/or isActive',
  });

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);
  app.addHook('preHandler', requireRole('ADMIN'));

  app.get('/admin/users', async () => {
    if (!prisma) {
      throw new HttpError(503, 'Database not configured');
    }
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        displayName: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    return { count: users.length, users };
  });

  app.patch('/admin/users/:id', async (request, reply) => {
    const params = request.params as { id?: string };
    if (!params.id) {
      throw new HttpError(400, 'Missing user id');
    }
    const parsed = updateUserSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new HttpError(400, 'Invalid request body');
    }
    if (!prisma) {
      throw new HttpError(503, 'Database not configured');
    }

    if (request.user?.id === params.id) {
      if (parsed.data.isActive === false) {
        throw new HttpError(400, 'You cannot deactivate your own account');
      }
      if (parsed.data.role === 'USER') {
        throw new HttpError(400, 'You cannot demote your own account');
      }
    }

    const existing = await prisma.user.findUnique({
      where: { id: params.id },
      select: { id: true },
    });
    if (!existing) {
      throw new HttpError(404, 'User not found');
    }

    const updated = await prisma.user.update({
      where: { id: params.id },
      data: parsed.data as { role?: Role; isActive?: boolean },
      select: {
        id: true,
        email: true,
        displayName: true,
        role: true,
        isActive: true,
      },
    });

    invalidateCachedUser(updated.id);

    recordAudit({
      actorId: request.user?.id,
      actorEmail: request.user?.email,
      action: 'admin.user.update',
      target: params.id,
      detail: JSON.stringify(parsed.data),
      ip: request.ip,
    });

    return reply.send({ user: updated });
  });

  app.get('/admin/audit', async (request) => {
    const query = request.query as { limit?: string };
    const parsed = Number.parseInt(query.limit ?? '200', 10);
    const limit = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 1000) : 200;
    const events = getAuditLogs(limit);
    return { count: events.length, events };
  });
}

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { HttpError, requireAuth } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';
import { isNotificationKind, isNotificationPriority } from '../proactive/types.js';

type NotificationQuery = {
  limit?: string;
  kind?: string;
  priority?: string;
  unread?: string;
};

function parseNotificationsQuery(request: FastifyRequest): {
  where: { userId: string; kind?: string; priority?: string; readAt?: null };
  take: number;
} {
  const query = request.query as NotificationQuery;
  const parsedLimit = Number.parseInt(query.limit ?? '50', 10);
  const take = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 100) : 50;

  const where: { userId: string; kind?: string; priority?: string; readAt?: null } = {
    userId: request.user?.id ?? '',
  };
  if (query.kind && isNotificationKind(query.kind)) {
    where.kind = query.kind;
  }
  if (query.priority && isNotificationPriority(query.priority)) {
    where.priority = query.priority;
  }
  if (query.unread === 'true') {
    where.readAt = null;
  }
  return { where, take };
}

export async function notificationRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  app.get('/notifications', async (request) => {
    if (!prisma) {
      throw new HttpError(503, 'Database not configured');
    }
    const userId = request.user?.id;
    if (!userId) {
      throw new HttpError(401, 'Unauthorized');
    }

    const { where, take } = parseNotificationsQuery(request);
    const notifications = await prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take,
      select: {
        id: true,
        title: true,
        body: true,
        kind: true,
        priority: true,
        metadata: true,
        readAt: true,
        createdAt: true,
      },
    });

    const unreadCount = await prisma.notification.count({
      where: { userId, readAt: null },
    });

    return { notifications, unreadCount };
  });

  app.patch('/notifications/:id/read', async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = request.user?.id;
    if (!userId) {
      throw new HttpError(401, 'Unauthorized');
    }
    if (!prisma) {
      throw new HttpError(503, 'Database not configured');
    }

    const existing = await prisma.notification.findFirst({ where: { id, userId } });
    if (!existing) {
      throw new HttpError(404, 'Notification not found');
    }

    await prisma.notification.update({
      where: { id },
      data: { readAt: new Date() },
    });

    return reply.status(204).send();
  });

  app.delete('/notifications/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = request.user?.id;
    if (!userId) {
      throw new HttpError(401, 'Unauthorized');
    }
    if (!prisma) {
      throw new HttpError(503, 'Database not configured');
    }

    const existing = await prisma.notification.findFirst({ where: { id, userId } });
    if (!existing) {
      throw new HttpError(404, 'Notification not found');
    }

    await prisma.notification.delete({ where: { id } });

    return reply.status(204).send();
  });

  app.post('/notifications/read-all', async (request, reply) => {
    const userId = request.user?.id;
    if (!userId) {
      throw new HttpError(401, 'Unauthorized');
    }
    if (!prisma) {
      throw new HttpError(503, 'Database not configured');
    }

    await prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });

    return reply.status(204).send();
  });
}

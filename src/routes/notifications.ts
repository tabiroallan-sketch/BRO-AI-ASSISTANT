import type { FastifyInstance } from 'fastify';
import { HttpError, requireAuth } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';

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

    const notifications = await prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        title: true,
        body: true,
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

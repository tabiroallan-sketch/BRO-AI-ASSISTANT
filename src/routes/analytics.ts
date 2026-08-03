import type { FastifyInstance } from 'fastify';
import { HttpError, requireAuth } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';

const ACTIVITY_DAYS = 14;

export async function analyticsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  app.get('/analytics', async (request) => {
    if (!prisma) {
      throw new HttpError(503, 'Database not configured');
    }
    const userId = request.user?.id;
    if (!userId) {
      throw new HttpError(401, 'Unauthorized');
    }

    const [
      conversationCount,
      memoryCount,
      integrationCount,
      notificationCount,
      userMessages,
      assistantMessages,
    ] = await Promise.all([
      prisma.conversation.count({ where: { userId } }),
      prisma.memory.count({ where: { userId } }),
      prisma.integration.count({ where: { userId } }),
      prisma.notification.count({ where: { userId } }),
      prisma.message.count({ where: { conversation: { userId }, role: 'USER' } }),
      prisma.message.count({ where: { conversation: { userId }, role: 'ASSISTANT' } }),
    ]);

    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);
    since.setUTCDate(since.getUTCDate() - (ACTIVITY_DAYS - 1));

    const recent = await prisma.message.findMany({
      where: { conversation: { userId }, createdAt: { gte: since } },
      select: { createdAt: true },
      orderBy: { createdAt: 'asc' },
    });

    const byDay = new Map<string, number>();
    for (const message of recent) {
      const key = message.createdAt.toISOString().slice(0, 10);
      byDay.set(key, (byDay.get(key) ?? 0) + 1);
    }

    const daily: { date: string; count: number }[] = [];
    for (let index = 0; index < ACTIVITY_DAYS; index += 1) {
      const day = new Date(since);
      day.setUTCDate(since.getUTCDate() + index);
      const key = day.toISOString().slice(0, 10);
      daily.push({ date: key, count: byDay.get(key) ?? 0 });
    }

    return {
      totals: {
        conversations: conversationCount,
        memories: memoryCount,
        integrations: integrationCount,
        notifications: notificationCount,
        messages: userMessages + assistantMessages,
      },
      messagesByRole: { user: userMessages, assistant: assistantMessages },
      daily,
    };
  });
}

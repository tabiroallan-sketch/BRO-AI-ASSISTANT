import type { FastifyInstance } from 'fastify';
import { HttpError, requireAuth } from '../lib/auth.js';
import { Prisma, prisma } from '../lib/prisma.js';
import { normalizeSettings } from '../proactive/settings.js';
import { getProactiveStatus, runProactiveSweep } from '../proactive/index.js';
import type { ProactiveSettings } from '../proactive/types.js';

export async function proactiveRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  app.get('/proactive/settings', async (request) => {
    const userId = request.user?.id;
    if (!userId) {
      throw new HttpError(401, 'Unauthorized');
    }
    if (!prisma) {
      throw new HttpError(503, 'Database not configured');
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { settings: true },
    });
    const settings = normalizeSettings(user?.settings ?? undefined);
    return { settings };
  });

  app.put('/proactive/settings', async (request, reply) => {
    const userId = request.user?.id;
    if (!userId) {
      throw new HttpError(401, 'Unauthorized');
    }
    if (!prisma) {
      throw new HttpError(503, 'Database not configured');
    }

    const body = (request.body ?? {}) as Record<string, unknown>;
    const input =
      typeof body.settings === 'object' && body.settings !== null ? body.settings : body;
    const settings: ProactiveSettings = normalizeSettings(input);

    await prisma.user.update({
      where: { id: userId },
      data: { settings: settings as unknown as Prisma.InputJsonValue },
    });

    return reply.status(200).send({ settings });
  });

  app.post('/proactive/run', async (request) => {
    const userId = request.user?.id;
    if (!userId) {
      throw new HttpError(401, 'Unauthorized');
    }
    const result = await runProactiveSweep();
    if (!result) {
      throw new HttpError(503, 'Proactive monitor is unavailable');
    }
    return result;
  });

  app.get('/proactive/status', async (request) => {
    const userId = request.user?.id;
    if (!userId) {
      throw new HttpError(401, 'Unauthorized');
    }
    return getProactiveStatus();
  });
}

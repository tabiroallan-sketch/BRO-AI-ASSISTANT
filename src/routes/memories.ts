import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { HttpError, requireAuth } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';

const createSchema = z.object({
  key: z.string().trim().min(1).max(200),
  value: z.string().trim().min(1).max(4000),
  category: z.string().trim().min(1).max(100).optional(),
});

const updateSchema = z.object({
  value: z.string().trim().min(1).max(4000).optional(),
  category: z.string().trim().min(1).max(100).nullable().optional(),
});

export async function memoryRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  app.get('/memories', async (request) => {
    if (!prisma) {
      throw new HttpError(503, 'Database not configured');
    }
    const userId = request.user?.id;
    if (!userId) {
      throw new HttpError(401, 'Unauthorized');
    }

    const memories = await prisma.memory.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        key: true,
        value: true,
        category: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return { memories };
  });

  app.post('/memories', async (request, reply) => {
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new HttpError(400, 'Invalid request body');
    }
    if (!prisma) {
      throw new HttpError(503, 'Database not configured');
    }
    const userId = request.user?.id;
    if (!userId) {
      throw new HttpError(401, 'Unauthorized');
    }

    const existing = await prisma.memory.findUnique({
      where: { userId_key: { userId, key: parsed.data.key } },
      select: { id: true },
    });

    const memory = await prisma.memory.upsert({
      where: { userId_key: { userId, key: parsed.data.key } },
      create: {
        userId,
        key: parsed.data.key,
        value: parsed.data.value,
        category: parsed.data.category ?? null,
      },
      update: {
        value: parsed.data.value,
        category: parsed.data.category ?? null,
      },
      select: {
        id: true,
        key: true,
        value: true,
        category: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return reply.status(existing ? 200 : 201).send({ memory });
  });

  app.patch('/memories/:id', async (request, reply) => {
    const parsed = updateSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new HttpError(400, 'Invalid request body');
    }
    const { id } = request.params as { id: string };
    const userId = request.user?.id;
    if (!userId) {
      throw new HttpError(401, 'Unauthorized');
    }
    if (!prisma) {
      throw new HttpError(503, 'Database not configured');
    }

    const existing = await prisma.memory.findFirst({ where: { id, userId } });
    if (!existing) {
      throw new HttpError(404, 'Memory not found');
    }

    const memory = await prisma.memory.update({
      where: { id },
      data: parsed.data,
      select: {
        id: true,
        key: true,
        value: true,
        category: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return reply.send({ memory });
  });

  app.delete('/memories/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = request.user?.id;
    if (!userId) {
      throw new HttpError(401, 'Unauthorized');
    }
    if (!prisma) {
      throw new HttpError(503, 'Database not configured');
    }

    const deleted = await prisma.memory.deleteMany({ where: { id, userId } });
    if (deleted.count === 0) {
      throw new HttpError(404, 'Memory not found');
    }
    return reply.status(204).send();
  });
}

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { HttpError, requireAuth } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';

const createSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
});

const renameSchema = z.object({
  title: z.string().trim().min(1).max(200),
});

function conversationSummary(
  conversation: {
    id: string;
    title: string | null;
    createdAt: Date;
    updatedAt: Date;
  } & { messageCount: number },
): {
  id: string;
  title: string | null;
  messageCount: number;
  createdAt: Date;
  updatedAt: Date;
} {
  return {
    id: conversation.id,
    title: conversation.title,
    messageCount: conversation.messageCount,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
  };
}

export async function conversationRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  app.get('/conversations', async (request) => {
    if (!prisma) {
      throw new HttpError(503, 'Database not configured');
    }
    const userId = request.user?.id;
    if (!userId) {
      throw new HttpError(401, 'Unauthorized');
    }

    const conversations = await prisma.conversation.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        title: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { messages: true } },
      },
    });

    return {
      conversations: conversations.map((conversation) =>
        conversationSummary({
          ...conversation,
          messageCount: conversation._count.messages,
        }),
      ),
    };
  });

  app.post('/conversations', async (request, reply) => {
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

    const conversation = await prisma.conversation.create({
      data: { userId, title: parsed.data.title ?? null },
      select: { id: true, title: true, createdAt: true, updatedAt: true },
    });

    return reply.status(201).send({
      conversation: conversationSummary({ ...conversation, messageCount: 0 }),
    });
  });

  app.get('/conversations/:id', async (request) => {
    const { id } = request.params as { id: string };
    const userId = request.user?.id;
    if (!userId) {
      throw new HttpError(401, 'Unauthorized');
    }
    if (!prisma) {
      throw new HttpError(503, 'Database not configured');
    }

    const conversation = await prisma.conversation.findFirst({
      where: { id, userId },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            role: true,
            content: true,
            createdAt: true,
          },
        },
      },
    });

    if (!conversation) {
      throw new HttpError(404, 'Conversation not found');
    }

    return { conversation };
  });

  app.patch('/conversations/:id', async (request, reply) => {
    const parsed = renameSchema.safeParse(request.body);
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

    const existing = await prisma.conversation.findFirst({ where: { id, userId } });
    if (!existing) {
      throw new HttpError(404, 'Conversation not found');
    }

    const conversation = await prisma.conversation.update({
      where: { id },
      data: { title: parsed.data.title },
      select: { id: true, title: true, createdAt: true, updatedAt: true },
    });

    return reply.send({ conversation: conversationSummary({ ...conversation, messageCount: 0 }) });
  });

  app.delete('/conversations/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = request.user?.id;
    if (!userId) {
      throw new HttpError(401, 'Unauthorized');
    }
    if (!prisma) {
      throw new HttpError(503, 'Database not configured');
    }

    const existing = await prisma.conversation.findFirst({ where: { id, userId } });
    if (!existing) {
      throw new HttpError(404, 'Conversation not found');
    }

    await prisma.conversation.delete({ where: { id } });
    return reply.status(204).send();
  });
}

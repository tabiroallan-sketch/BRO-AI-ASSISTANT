import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { HttpError, requireAuth } from '../lib/auth.js';
import { fetchMemoryRecords, reinforceMemories } from '../lib/memory-store.js';
import type { Prisma } from '../lib/prisma.js';
import { prisma } from '../lib/prisma.js';
import {
  MEMORY_DIGEST_TTL_MS,
  MEMORY_IMPORTANCE_DEFAULT,
  MEMORY_IMPORTANCE_MAX,
  MEMORY_IMPORTANCE_MIN,
  MEMORY_RELATED_MAX,
  MEMORY_TAGS_MAX,
  MEMORY_TAG_MAX_LENGTH,
  buildMemoryTimeline,
  parseMemoryMetadata,
  rankMemoriesByQuery,
  serializeMemoryMetadata,
  summarizeMemoryStore,
  type MemoryMeta,
  type MemoryRecord,
} from '../memory-engine/index.js';

const kindSchema = z.enum([
  'project',
  'goal',
  'client',
  'preference',
  'coding-style',
  'meeting',
  'idea',
  'task',
  'relationship',
  'other',
]);
const importanceSchema = z.number().int().min(MEMORY_IMPORTANCE_MIN).max(MEMORY_IMPORTANCE_MAX);
const tagsSchema = z
  .array(z.string().trim().min(1).max(MEMORY_TAG_MAX_LENGTH))
  .max(MEMORY_TAGS_MAX);
const relatedSchema = z.array(z.string().trim().min(1).max(200)).max(MEMORY_RELATED_MAX);

const createSchema = z.object({
  key: z.string().trim().min(1).max(200),
  value: z.string().trim().min(1).max(4000),
  category: z.string().trim().min(1).max(100).optional(),
  kind: kindSchema.optional(),
  importance: importanceSchema.optional(),
  tags: tagsSchema.optional(),
  relatedIds: relatedSchema.optional(),
});

const updateSchema = z
  .object({
    value: z.string().trim().min(1).max(4000).optional(),
    category: z.string().trim().min(1).max(100).nullable().optional(),
    kind: kindSchema.optional(),
    importance: importanceSchema.optional(),
    tags: tagsSchema.optional(),
    relatedIds: relatedSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update',
  });

const listSchema = z.object({
  q: z.string().trim().max(500).optional(),
  category: z.string().trim().max(100).optional(),
  kind: kindSchema.optional(),
});

type MemoryLike = {
  id: string;
  key: string;
  value: string;
  category: string | null;
  createdAt: Date;
  updatedAt: Date;
  meta?: MemoryMeta;
  metadata?: unknown;
};

function memoryResponse(item: MemoryLike): Record<string, unknown> {
  const meta = item.meta ?? parseMemoryMetadata(item.metadata);
  return {
    id: item.id,
    key: item.key,
    value: item.value,
    category: item.category,
    kind: meta.kind,
    importance: meta.importance,
    tags: meta.tags,
    relatedIds: meta.relatedIds,
    lastAccessedAt: meta.lastAccessedAt ?? null,
    accessCount: meta.accessCount,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function recordResponse(record: MemoryRecord): Record<string, unknown> {
  return memoryResponse({ ...record, meta: record.meta });
}

function selectMemoryRow(): Prisma.MemorySelect {
  return {
    id: true,
    key: true,
    value: true,
    category: true,
    metadata: true,
    createdAt: true,
    updatedAt: true,
  };
}

const digestCache = new Map<string, { summary: string; at: number }>();

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
    const query = listSchema.safeParse(request.query);
    if (!query.success) {
      throw new HttpError(400, 'Invalid query parameters');
    }

    const records = await fetchMemoryRecords(prisma, userId);
    let filtered = records;
    if (query.data.category) {
      const category = query.data.category.toLowerCase();
      filtered = filtered.filter((record) => record.category?.toLowerCase() === category);
    }
    if (query.data.kind) {
      filtered = filtered.filter((record) => record.meta.kind === query.data.kind);
    }

    if (query.data.q) {
      const now = new Date();
      const ranked = rankMemoriesByQuery(filtered, query.data.q, now, filtered.length);
      reinforceMemories(
        prisma,
        ranked.slice(0, 10).map((record) => record.id),
        now,
      ).catch((error) => request.log.warn({ err: error }, 'Failed to reinforce recalled memories'));
      return { memories: ranked.map(recordResponse) };
    }

    return { memories: filtered.map(recordResponse) };
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

    const meta: MemoryMeta = {
      kind: parsed.data.kind ?? 'other',
      importance: parsed.data.importance ?? MEMORY_IMPORTANCE_DEFAULT,
      tags: parsed.data.tags ?? [],
      relatedIds: parsed.data.relatedIds ?? [],
      accessCount: 0,
    };

    const memory = await prisma.memory.upsert({
      where: { userId_key: { userId, key: parsed.data.key } },
      create: {
        userId,
        key: parsed.data.key,
        value: parsed.data.value,
        category: parsed.data.category ?? null,
        metadata: serializeMemoryMetadata(meta) as unknown as Prisma.InputJsonValue,
      },
      update: {
        value: parsed.data.value,
        category: parsed.data.category ?? null,
        metadata: serializeMemoryMetadata(meta) as unknown as Prisma.InputJsonValue,
      },
      select: selectMemoryRow(),
    });

    return reply.status(existing ? 200 : 201).send({ memory: memoryResponse(memory) });
  });

  app.patch('/memories/:id', async (request) => {
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

    const metaChanged =
      parsed.data.kind !== undefined ||
      parsed.data.importance !== undefined ||
      parsed.data.tags !== undefined ||
      parsed.data.relatedIds !== undefined;
    const base = parseMemoryMetadata(existing.metadata);
    const meta: MemoryMeta = {
      kind: parsed.data.kind ?? base.kind,
      importance: parsed.data.importance ?? base.importance,
      tags: parsed.data.tags ?? base.tags,
      relatedIds: parsed.data.relatedIds ?? base.relatedIds,
      lastAccessedAt: base.lastAccessedAt,
      accessCount: base.accessCount,
    };

    const memory = await prisma.memory.update({
      where: { id },
      data: {
        ...(parsed.data.value !== undefined ? { value: parsed.data.value } : {}),
        ...(parsed.data.category !== undefined ? { category: parsed.data.category } : {}),
        ...(metaChanged
          ? { metadata: serializeMemoryMetadata(meta) as unknown as Prisma.InputJsonValue }
          : {}),
      },
      select: selectMemoryRow(),
    });

    return { memory: memoryResponse(memory) };
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

  app.get('/memories/timeline', async (request) => {
    if (!prisma) {
      throw new HttpError(503, 'Database not configured');
    }
    const userId = request.user?.id;
    if (!userId) {
      throw new HttpError(401, 'Unauthorized');
    }

    const records = await fetchMemoryRecords(prisma, userId);
    const groups = buildMemoryTimeline(records).map((group) => ({
      label: group.label,
      items: group.items.map((item) => ({
        ...recordResponse(item.record),
        activity: item.activity,
      })),
    }));
    return { groups };
  });

  app.get('/memories/summary', async (request) => {
    if (!prisma) {
      throw new HttpError(503, 'Database not configured');
    }
    const userId = request.user?.id;
    if (!userId) {
      throw new HttpError(401, 'Unauthorized');
    }

    const cached = digestCache.get(userId);
    if (cached && Date.now() - cached.at < MEMORY_DIGEST_TTL_MS) {
      return { summary: cached.summary };
    }

    const records = await fetchMemoryRecords(prisma, userId);
    if (records.length === 0) {
      return { summary: null };
    }

    try {
      const summary = await summarizeMemoryStore(records);
      digestCache.set(userId, { summary, at: Date.now() });
      return { summary };
    } catch (error) {
      request.log.warn({ err: error }, 'Memory store digest failed');
      return { summary: null };
    }
  });
}

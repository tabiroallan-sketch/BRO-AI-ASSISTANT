import type { PrismaClient } from '../generated/index.js';
import type { Prisma } from './prisma.js';
import { reinforce } from '../memory-engine/decay.js';
import {
  parseMemoryMetadata,
  parseMemoryRecord,
  serializeMemoryMetadata,
  type MemoryRow,
} from '../memory-engine/metadata.js';
import {
  MEMORY_IMPORTANCE_DEFAULT,
  MEMORY_SEARCH_LIMIT,
  type MemoryExtraction,
  type MemoryMeta,
  type MemoryRecord,
} from '../memory-engine/types.js';

const RECORD_SELECT = {
  id: true,
  key: true,
  value: true,
  category: true,
  metadata: true,
  createdAt: true,
  updatedAt: true,
} as const;

/** Fetches the user's memory rows (capped) and parses them into records. */
export async function fetchMemoryRecords(
  db: PrismaClient,
  userId: string,
): Promise<MemoryRecord[]> {
  const rows = await db.memory.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
    take: MEMORY_SEARCH_LIMIT,
    select: RECORD_SELECT,
  });
  return rows.map((row) => parseMemoryRecord(row as unknown as MemoryRow));
}

/**
 * Marks the given memories as recalled right now (refreshes decay, counts an
 * access). Fire-and-forget; callers own error handling.
 */
export async function reinforceMemories(db: PrismaClient, ids: string[], now: Date): Promise<void> {
  if (ids.length === 0) {
    return;
  }
  const rows = await db.memory.findMany({ where: { id: { in: ids } }, select: RECORD_SELECT });
  for (const row of rows) {
    const meta = reinforce(parseMemoryMetadata(row.metadata), now);
    await db.memory.update({
      where: { id: row.id },
      data: { metadata: serializeMemoryMetadata(meta) as unknown as Prisma.InputJsonValue },
    });
  }
}

/**
 * Persists a memory extraction: creates new memories and applies field changes
 * to existing ones. Existing records are needed so preserved fields (decay,
 * access stats) survive an update.
 */
export async function persistMemoryExtraction(
  db: PrismaClient,
  userId: string,
  extraction: MemoryExtraction,
  existingRecords: MemoryRecord[],
): Promise<void> {
  for (const draft of extraction.add) {
    const meta: MemoryMeta = {
      kind: draft.kind ?? 'other',
      importance: draft.importance ?? MEMORY_IMPORTANCE_DEFAULT,
      tags: draft.tags ?? [],
      relatedIds: draft.relatedIds ?? [],
      accessCount: 0,
    };
    await db.memory.upsert({
      where: { userId_key: { userId, key: draft.key } },
      create: {
        userId,
        key: draft.key,
        value: draft.value,
        category: draft.category ?? null,
        metadata: serializeMemoryMetadata(meta) as unknown as Prisma.InputJsonValue,
      },
      update: {
        value: draft.value,
        category: draft.category ?? null,
        metadata: serializeMemoryMetadata(meta) as unknown as Prisma.InputJsonValue,
      },
    });
  }
  for (const update of extraction.update) {
    const current = existingRecords.find((record) => record.id === update.id);
    const meta: MemoryMeta = {
      kind: update.kind ?? current?.meta.kind ?? 'other',
      importance: update.importance ?? current?.meta.importance ?? MEMORY_IMPORTANCE_DEFAULT,
      tags: update.tags ?? current?.meta.tags ?? [],
      relatedIds: update.relatedIds ?? current?.meta.relatedIds ?? [],
      lastAccessedAt: current?.meta.lastAccessedAt,
      accessCount: current?.meta.accessCount ?? 0,
    };
    await db.memory.update({
      where: { id: update.id },
      data: {
        ...(update.value !== undefined ? { value: update.value } : {}),
        ...(update.category !== undefined ? { category: update.category } : {}),
        metadata: serializeMemoryMetadata(meta) as unknown as Prisma.InputJsonValue,
      },
    });
  }
}

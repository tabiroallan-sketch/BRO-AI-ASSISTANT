import {
  MEMORY_IMPORTANCE_DEFAULT,
  MEMORY_IMPORTANCE_MAX,
  MEMORY_IMPORTANCE_MIN,
  MEMORY_KINDS,
  MEMORY_META_VERSION,
  MEMORY_TAGS_MAX,
  MEMORY_TAG_MAX_LENGTH,
  type MemoryKind,
  type MemoryMeta,
  type MemoryRecord,
} from './types.js';

/** Minimal DB-row shape accepted by {@link parseMemoryRecord}. */
export type MemoryRow = {
  id: string;
  key: string;
  value: string;
  category: string | null;
  metadata?: unknown;
  createdAt: Date;
  updatedAt: Date;
};

/** Converts a DB row into the memory-engine's working shape. */
export function parseMemoryRecord(row: MemoryRow): MemoryRecord {
  return {
    id: row.id,
    key: row.key,
    value: row.value,
    category: row.category,
    meta: parseMemoryMetadata(row.metadata),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Base metadata used when a memory row has no stored metadata yet. */
export function defaultMemoryMeta(): MemoryMeta {
  return {
    kind: 'other',
    importance: MEMORY_IMPORTANCE_DEFAULT,
    tags: [],
    relatedIds: [],
    accessCount: 0,
  };
}

/** Reads the JSONB `Memory.metadata` column into a well-formed MemoryMeta. */
export function parseMemoryMetadata(raw: unknown): MemoryMeta {
  if (!raw || typeof raw !== 'object') {
    return defaultMemoryMeta();
  }
  const value = raw as Record<string, unknown>;
  return {
    kind: normalizeKind(value.kind),
    importance: clampImportance(value.importance),
    tags: normalizeStrings(value.tags),
    relatedIds: normalizeStrings(value.relatedIds),
    lastAccessedAt: typeof value.lastAccessedAt === 'string' ? value.lastAccessedAt : undefined,
    accessCount:
      typeof value.accessCount === 'number' && Number.isFinite(value.accessCount)
        ? Math.max(0, Math.floor(value.accessCount))
        : 0,
  };
}

/** Serializes MemoryMeta for the JSONB `Memory.metadata` column. */
export function serializeMemoryMetadata(meta: MemoryMeta): Record<string, unknown> {
  return {
    v: MEMORY_META_VERSION,
    kind: meta.kind,
    importance: meta.importance,
    tags: meta.tags,
    relatedIds: meta.relatedIds,
    ...(meta.lastAccessedAt ? { lastAccessedAt: meta.lastAccessedAt } : {}),
    accessCount: meta.accessCount,
  };
}

function normalizeKind(value: unknown): MemoryKind {
  return MEMORY_KINDS.includes(value as MemoryKind) ? (value as MemoryKind) : 'other';
}

function clampImportance(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return MEMORY_IMPORTANCE_DEFAULT;
  }
  return Math.min(MEMORY_IMPORTANCE_MAX, Math.max(MEMORY_IMPORTANCE_MIN, Math.round(value)));
}

function normalizeStrings(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') {
      continue;
    }
    const trimmed = item.trim();
    if (!trimmed || trimmed.length > MEMORY_TAG_MAX_LENGTH || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    result.push(trimmed);
    if (result.length >= MEMORY_TAGS_MAX) {
      break;
    }
  }
  return result;
}

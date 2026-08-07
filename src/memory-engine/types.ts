/**
 * Long Term Memory (Stage 8): shared types and tuning constants.
 *
 * The pure, provider-independent logic lives in metadata.ts, vector.ts,
 * decay.ts, search.ts, timeline.ts, extract.ts and summary.ts; index.ts is the
 * thin layer that wires the pieces to the LLM providers. Memory richness
 * (kind, importance, tags, related memories, recall stats) is persisted on the
 * existing `Memory.metadata` JSONB column — no schema migration is required.
 */

export type MemoryKind =
  | 'project'
  | 'goal'
  | 'client'
  | 'preference'
  | 'coding-style'
  | 'meeting'
  | 'idea'
  | 'task'
  | 'relationship'
  | 'other';

export const MEMORY_KINDS: readonly MemoryKind[] = [
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
];

/** Structured metadata persisted on `Memory.metadata` (JSONB). */
export type MemoryMeta = {
  kind: MemoryKind;
  importance: number;
  tags: string[];
  relatedIds: string[];
  lastAccessedAt?: string;
  accessCount: number;
};

/** A memory record as the memory engine works with it (parsed from a DB row). */
export type MemoryRecord = {
  id: string;
  key: string;
  value: string;
  category: string | null;
  meta: MemoryMeta;
  createdAt: Date;
  updatedAt: Date;
};

/** A new memory to create (add) or the changed fields for an existing one. */
export type MemoryDraft = {
  key: string;
  value: string;
  category?: string | null;
  kind?: MemoryKind;
  importance?: number;
  tags?: string[];
  relatedIds?: string[];
};

export type MemoryUpdate = {
  id: string;
  value?: string;
  category?: string | null;
  kind?: MemoryKind;
  importance?: number;
  tags?: string[];
  relatedIds?: string[];
};

/** Split of a memory extraction into new memories and changes to existing ones. */
export type MemoryExtraction = {
  add: MemoryDraft[];
  update: MemoryUpdate[];
};

/** A turn of conversation used as input for memory extraction. */
export type MemoryTurn = {
  role: 'USER' | 'ASSISTANT';
  content: string;
};

export const MEMORY_META_VERSION = 1;
export const MEMORY_IMPORTANCE_MIN = 1;
export const MEMORY_IMPORTANCE_MAX = 10;
export const MEMORY_IMPORTANCE_DEFAULT = 5;
export const MEMORY_DEFAULT_KIND: MemoryKind = 'other';
export const MEMORY_TAGS_MAX = 8;
export const MEMORY_TAG_MAX_LENGTH = 50;
export const MEMORY_RELATED_MAX = 8;
export const MEMORY_KEY_MAX = 200;
export const MEMORY_VALUE_MAX = 4000;
export const MEMORY_CATEGORY_MAX = 100;
/** Freshness half-life in days: a memory halves in weight after this long unseen. */
export const MEMORY_DECAY_HALF_LIFE_DAYS = 30;
/** Most memories considered for ranking/search before top-K selection. */
export const MEMORY_SEARCH_LIMIT = 500;
/** Default cap for ranking results. */
export const MEMORY_SEARCH_TOP_K = 20;
/** Max memories the extractor may suggest adding per turn. */
export const MEMORY_EXTRACTION_MAX = 8;
/** Rough input cap for a memory-store digest request. */
export const MEMORY_DIGEST_MAX_LENGTH = 12_000;
/** How long a computed memory-store digest is cached per user. */
export const MEMORY_DIGEST_TTL_MS = 15 * 60 * 1000;

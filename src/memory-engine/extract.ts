import {
  MEMORY_EXTRACTION_MAX,
  MEMORY_KINDS,
  MEMORY_IMPORTANCE_MAX,
  MEMORY_IMPORTANCE_MIN,
  MEMORY_KEY_MAX,
  MEMORY_VALUE_MAX,
  MEMORY_CATEGORY_MAX,
  MEMORY_TAGS_MAX,
  MEMORY_TAG_MAX_LENGTH,
  MEMORY_RELATED_MAX,
  type MemoryDraft,
  type MemoryExtraction,
  type MemoryKind,
  type MemoryRecord,
  type MemoryUpdate,
} from './types.js';

/** Parses the model's JSON output into memory drafts; undefined when not JSON. */
export function parseExtractionJson(raw: string): MemoryDraft[] | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== 'object') {
    return undefined;
  }
  const value = parsed as Record<string, unknown>;
  const list = Array.isArray(value.memories)
    ? value.memories
    : Array.isArray(value.add)
      ? value.add
      : Array.isArray(parsed)
        ? parsed
        : undefined;
  if (!Array.isArray(list)) {
    return undefined;
  }
  const drafts: MemoryDraft[] = [];
  for (const item of list) {
    const draft = normalizeDraft(item);
    if (draft) {
      drafts.push(draft);
    }
  }
  return drafts.slice(0, MEMORY_EXTRACTION_MAX);
}

/** Validates and normalizes a single raw extraction entry into a MemoryDraft. */
export function normalizeDraft(item: unknown): MemoryDraft | undefined {
  if (!item || typeof item !== 'object') {
    return undefined;
  }
  const value = item as Record<string, unknown>;
  const key = typeof value.key === 'string' ? value.key.trim() : '';
  const text = typeof value.value === 'string' ? value.value.trim() : '';
  if (!key || key.length > MEMORY_KEY_MAX || !text || text.length > MEMORY_VALUE_MAX) {
    return undefined;
  }
  const draft: MemoryDraft = { key, value: text };
  if (typeof value.category === 'string' && value.category.trim()) {
    const category = value.category.trim();
    if (category.length <= MEMORY_CATEGORY_MAX) {
      draft.category = category;
    }
  }
  const kind = normalizeKind(value.kind);
  if (kind !== 'other') {
    draft.kind = kind;
  }
  const importance = normalizeImportance(value.importance);
  if (importance !== undefined) {
    draft.importance = importance;
  }
  const tags = normalizeList(value.tags, MEMORY_TAGS_MAX, MEMORY_TAG_MAX_LENGTH);
  if (tags.length > 0) {
    draft.tags = tags;
  }
  const relatedIds = normalizeList(value.relatedIds, MEMORY_RELATED_MAX, 200);
  if (relatedIds.length > 0) {
    draft.relatedIds = relatedIds;
  }
  return draft;
}

/**
 * Splits normalized drafts against the current store: new keys become `add`,
 * existing keys become `update` only when at least one field actually changes.
 */
export function mergeExtraction(drafts: MemoryDraft[], existing: MemoryRecord[]): MemoryExtraction {
  const byKey = new Map(existing.map((record) => [record.key.toLowerCase(), record]));
  const add: MemoryDraft[] = [];
  const update: MemoryUpdate[] = [];
  for (const draft of drafts) {
    const current = byKey.get(draft.key.toLowerCase());
    if (!current) {
      add.push(draft);
      continue;
    }
    const changes: MemoryUpdate = { id: current.id };
    if (draft.value !== current.value) {
      changes.value = draft.value;
    }
    if (draft.category !== undefined && draft.category !== current.category) {
      changes.category = draft.category;
    }
    if (draft.kind !== undefined && draft.kind !== current.meta.kind) {
      changes.kind = draft.kind;
    }
    if (draft.importance !== undefined && draft.importance !== current.meta.importance) {
      changes.importance = draft.importance;
    }
    if (draft.tags !== undefined && !sameList(draft.tags, current.meta.tags)) {
      changes.tags = draft.tags;
    }
    if (draft.relatedIds !== undefined && !sameList(draft.relatedIds, current.meta.relatedIds)) {
      changes.relatedIds = draft.relatedIds;
    }
    if (Object.keys(changes).length > 1) {
      update.push(changes);
    }
  }
  return { add, update };
}

function normalizeKind(value: unknown): MemoryKind {
  return MEMORY_KINDS.includes(value as MemoryKind) ? (value as MemoryKind) : 'other';
}

function normalizeImportance(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.min(MEMORY_IMPORTANCE_MAX, Math.max(MEMORY_IMPORTANCE_MIN, Math.round(value)));
}

function normalizeList(value: unknown, max: number, maxLength: number): string[] {
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
    if (!trimmed || trimmed.length > maxLength || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    result.push(trimmed);
    if (result.length >= max) {
      break;
    }
  }
  return result;
}

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((item) => b.includes(item));
}

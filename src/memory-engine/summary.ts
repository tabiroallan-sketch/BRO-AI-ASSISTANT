import { MEMORY_DIGEST_MAX_LENGTH } from './types.js';
import type { MemoryRecord } from './types.js';

export type CategoryGroup = {
  category: string;
  records: MemoryRecord[];
};

/** Groups memories by category, ordering each group by importance then recency. */
export function groupMemoriesByCategory(records: MemoryRecord[]): CategoryGroup[] {
  const byCategory = new Map<string, MemoryRecord[]>();
  for (const record of records) {
    const category = record.category ?? 'uncategorized';
    const group = byCategory.get(category);
    if (group) {
      group.push(record);
    } else {
      byCategory.set(category, [record]);
    }
  }
  const groups = [...byCategory.entries()].map(([category, items]) => ({
    category,
    records: items.sort(
      (a, b) =>
        b.meta.importance - a.meta.importance || b.updatedAt.getTime() - a.updatedAt.getTime(),
    ),
  }));
  return groups.sort((a, b) => {
    if (a.category === 'uncategorized') {
      return 1;
    }
    if (b.category === 'uncategorized') {
      return -1;
    }
    return a.category.localeCompare(b.category);
  });
}

/** Formats the store into a compact text block for the digest request. */
export function formatMemoryDigestInput(
  records: MemoryRecord[],
  maxLength = MEMORY_DIGEST_MAX_LENGTH,
): string {
  const groups = groupMemoriesByCategory(records);
  const lines: string[] = [];
  for (const group of groups) {
    lines.push(`## ${group.category}`);
    for (const record of group.records) {
      lines.push(
        `- ${record.key}: ${record.value} (${record.meta.kind}, importance ${record.meta.importance})`,
      );
    }
  }
  const text = lines.join('\n');
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

/** Extracts a plain-text digest from the model's JSON (or raw) output. */
export function parseDigestJson(raw: string): string | undefined {
  const trimmed = raw.trim();
  const fenced = trimmed.replace(/^```(?:json)?\s*|```$/gi, '').trim();
  try {
    const parsed = JSON.parse(fenced) as unknown;
    if (parsed && typeof parsed === 'object') {
      const value = parsed as Record<string, unknown>;
      const summary = value.summary ?? value.digest;
      if (typeof summary === 'string' && summary.trim()) {
        return summary.trim();
      }
    }
  } catch {
    // Not JSON; fall through to the raw-text path.
  }
  return trimmed.length > 0 ? trimmed : undefined;
}

import { decayScore } from './decay.js';
import { MEMORY_SEARCH_TOP_K } from './types.js';
import type { MemoryRecord } from './types.js';
import { buildMemoryIndex, searchMemoryIndex, wordTokens } from './vector.js';

/** True when two tokens match exactly or share a prefix of at least 3 chars. */
function tokenMatch(a: string, b: string): boolean {
  return a === b || (a.length >= 3 && b.length >= 3 && (a.startsWith(b) || b.startsWith(a)));
}

/** Number of query tokens that match a fact token (prefix-aware). */
function exactOverlap(queryTokens: string[], factTokens: string[]): number {
  if (queryTokens.length === 0 || factTokens.length === 0) {
    return 0;
  }
  return queryTokens.filter((token) => factTokens.some((candidate) => tokenMatch(token, candidate)))
    .length;
}

function byScoreThenRecency(
  a: { record: MemoryRecord; score: number },
  b: { record: MemoryRecord; score: number },
): number {
  return b.score - a.score || b.record.updatedAt.getTime() - a.record.updatedAt.getTime();
}

/**
 * Ranks memories for a free-text query: TF-IDF vector similarity weighted most,
 * then an exact/prefix token bonus (keeps short queries precise), then vitality
 * (importance damped by decay). Ties break by most recently updated.
 */
export function rankMemoriesByQuery(
  records: MemoryRecord[],
  query: string,
  now: Date,
  topK = MEMORY_SEARCH_TOP_K,
): MemoryRecord[] {
  if (records.length === 0) {
    return [];
  }
  const index = buildMemoryIndex(records);
  const hits = new Map(
    searchMemoryIndex(index, query, records.length).map((hit) => [hit.id, hit.score]),
  );
  const queryTokens = wordTokens(query);
  const scored = records.map((record) => {
    const semantic = hits.get(record.id) ?? 0;
    const exact = exactOverlap(
      queryTokens,
      wordTokens(`${record.key} ${record.value} ${record.category ?? ''}`),
    );
    const vitality = decayScore(record.meta, now, record.updatedAt) / 10;
    const score = semantic * 4 + Math.min(exact, 3) * 1.5 + vitality * 2;
    return { record, score };
  });
  scored.sort(byScoreThenRecency);
  return scored.slice(0, topK).map(({ record }) => record);
}

/**
 * Ranks memories for the chat recall prompt: like {@link rankMemoriesByQuery}
 * but also rewards overlap with the recent conversation history, and when the
 * query and history are both empty it falls back to vitality so long-standing
 * personalization (e.g. the user's name) is never dropped.
 */
export function rankMemoriesForChat(
  records: MemoryRecord[],
  query: string,
  history: string,
  now: Date,
  topK = MEMORY_SEARCH_TOP_K,
): MemoryRecord[] {
  if (records.length === 0) {
    return [];
  }
  const queryTokens = wordTokens(query);
  const historyTokens = wordTokens(history);
  if (queryTokens.length === 0 && historyTokens.length === 0) {
    return [...records]
      .sort(
        (a, b) =>
          decayScore(b.meta, now, b.updatedAt) - decayScore(a.meta, now, a.updatedAt) ||
          b.updatedAt.getTime() - a.updatedAt.getTime(),
      )
      .slice(0, topK);
  }

  const index = buildMemoryIndex(records);
  const hits = new Map(
    searchMemoryIndex(index, query, records.length).map((hit) => [hit.id, hit.score]),
  );
  const scored = records.map((record) => {
    const semantic = hits.get(record.id) ?? 0;
    const factTokens = wordTokens(`${record.key} ${record.value} ${record.category ?? ''}`);
    const exact = exactOverlap(queryTokens, factTokens);
    const historyOverlap = exactOverlap(historyTokens, factTokens);
    const vitality = decayScore(record.meta, now, record.updatedAt) / 10;
    const score = semantic * 4 + Math.min(exact, 3) * 1.5 + historyOverlap * 0.5 + vitality * 2;
    return { record, score };
  });
  scored.sort(byScoreThenRecency);
  return scored.slice(0, topK).map(({ record }) => record);
}

/** Ranks memories purely by vitality (used when no query applies). */
export function rankMemoriesByVitality(
  records: MemoryRecord[],
  now: Date,
  topK = MEMORY_SEARCH_TOP_K,
): MemoryRecord[] {
  return [...records]
    .sort(
      (a, b) =>
        decayScore(b.meta, now, b.updatedAt) - decayScore(a.meta, now, a.updatedAt) ||
        b.updatedAt.getTime() - a.updatedAt.getTime(),
    )
    .slice(0, topK);
}

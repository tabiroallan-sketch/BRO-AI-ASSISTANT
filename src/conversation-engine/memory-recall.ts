import type { MemoryFact } from './types.js';

const STOPWORDS = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'but',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'to',
  'of',
  'for',
  'with',
  'on',
  'at',
  'in',
  'from',
  'by',
  'it',
  'its',
  'this',
  'that',
  'these',
  'those',
  'you',
  'your',
  'my',
  'i',
  'me',
  'we',
  'our',
  'as',
  'if',
  'then',
  'so',
  'not',
  'no',
  'can',
  'could',
  'will',
  'would',
  'do',
  'does',
  'did',
  'should',
  'may',
  'might',
  'what',
  'why',
  'how',
  'when',
  'where',
]);

function tokens(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9']{2,}/g) ?? []).filter(
    (token) => !STOPWORDS.has(token),
  );
}

/** True when two tokens match exactly or share a prefix of at least 3 chars. */
function tokenMatch(a: string, b: string): boolean {
  return a === b || (a.length >= 3 && b.length >= 3 && (a.startsWith(b) || b.startsWith(a)));
}

function overlapCount(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) {
    return 0;
  }
  return a.filter((token) => b.some((candidate) => tokenMatch(token, candidate))).length;
}

/**
 * Scores how relevant a stored memory is to the current message + recent
 * conversation. Direct matches on the current message weigh most, the category
 * second, and matches anywhere in the recent history weigh least.
 */
export function scoreMemory(memory: MemoryFact, query: string, history: string): number {
  const queryTokens = tokens(query);
  const factTokens = tokens(`${memory.key} ${memory.value}`);
  const historyTokens = tokens(history);
  const categoryTokens = memory.category ? tokens(memory.category) : [];
  return (
    overlapCount(queryTokens, factTokens) * 3 +
    overlapCount(queryTokens, categoryTokens) * 2 +
    overlapCount(historyTokens, factTokens)
  );
}

/**
 * Ranks memories by relevance, breaking ties by most recently updated, and
 * returns the top K. Zero-score memories are still included when there are not
 * enough matches so long-standing personalization (e.g. the user's name) is
 * never dropped entirely.
 */
export function rankMemories(
  memories: MemoryFact[],
  query: string,
  history: string,
  topK: number,
): MemoryFact[] {
  return [...memories]
    .map((memory) => ({ memory, score: scoreMemory(memory, query, history) }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        (b.memory.updatedAt?.getTime() ?? 0) - (a.memory.updatedAt?.getTime() ?? 0),
    )
    .slice(0, topK)
    .map(({ memory }) => memory);
}

export function formatMemories(memories: MemoryFact[]): string {
  return memories.map((memory) => `- ${memory.key}: ${memory.value}`).join('\n');
}

import { runCompletion } from '../conversation-engine/index.js';
import { parseExtractionJson } from './extract.js';
import { formatMemoryDigestInput, parseDigestJson } from './summary.js';
import type { MemoryDraft, MemoryRecord, MemoryTurn } from './types.js';

export * from './types.js';
export * from './metadata.js';
export * from './vector.js';
export * from './decay.js';
export * from './search.js';
export * from './timeline.js';
export * from './extract.js';
export * from './summary.js';

const EXTRACTION_SYSTEM_PROMPT =
  'You are a long-term memory recorder. From the conversation turns below, extract durable, ' +
  'specific facts about the user worth remembering across sessions: identity, preferences, ' +
  'projects, goals, clients, coding style, meetings, ideas, relationships and tasks. ' +
  'Skip ephemeral small talk, one-off questions and obvious requests the user can repeat. ' +
  'Respond with ONLY valid JSON in this exact shape: ' +
  '{"memories":[{"key":"kebab-case-key","value":"the fact","category":"personal|work|tech|...",' +
  '"kind":"project|goal|client|preference|coding-style|meeting|idea|task|relationship|other",' +
  '"importance":5,"tags":["tag1"],"relatedIds":[]}]}. ' +
  'Importance is 1-10 (10 = critical, 5 = default). Prefer a handful of high-signal memories over many.';

const DIGEST_SYSTEM_PROMPT =
  "You are a memory curator. Below is a user's long-term memory store grouped by category. " +
  'Write a short digest (200 words max) that describes who this user is, what they are working ' +
  'on, their key relationships and preferences, and anything time-sensitive. Write in the same ' +
  'language as the memories. Respond with ONLY valid JSON in this exact shape: {"summary": "..."}';

/**
 * Asks the configured provider to mine new memories from a turn of conversation.
 * Pure LLM concern; callers fire-and-forget (async best-effort) and merge the
 * result against the store with `mergeExtraction`.
 */
export async function extractMemoriesFromConversation(
  turns: MemoryTurn[],
  preferredProviderId?: string,
): Promise<MemoryDraft[]> {
  const input = turns
    .map((turn) => `${turn.role === 'USER' ? 'User' : 'Assistant'}: ${turn.content}`)
    .join('\n')
    .trim();
  if (!input) {
    return [];
  }
  const result = await runCompletion(
    {
      messages: [
        { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
        { role: 'user', content: input },
      ],
      temperature: 0.2,
      maxTokens: 400,
    },
    preferredProviderId,
  );
  return parseExtractionJson(result.content) ?? [];
}

/**
 * Summarizes the whole memory store into a short digest via the configured
 * provider. Throws when no provider is configured or the call fails.
 */
export async function summarizeMemoryStore(
  records: MemoryRecord[],
  preferredProviderId?: string,
): Promise<string> {
  const input = formatMemoryDigestInput(records);
  if (!input.trim()) {
    return '';
  }
  const result = await runCompletion(
    {
      messages: [
        { role: 'system', content: DIGEST_SYSTEM_PROMPT },
        { role: 'user', content: input },
      ],
      temperature: 0.3,
      maxTokens: 300,
    },
    preferredProviderId,
  );
  return parseDigestJson(result.content) ?? '';
}

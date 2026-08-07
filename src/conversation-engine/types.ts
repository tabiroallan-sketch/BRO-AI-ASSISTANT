/**
 * Conversation Engine (Stage 7): shared types and tuning constants.
 *
 * The pure, provider-independent logic lives in intent.ts, memory-recall.ts,
 * clarify.ts, task.ts, summary.ts, context.ts and state.ts; index.ts is the
 * thin layer that wires those pieces to the LLM providers. Conversation state
 * is persisted on `Conversation.metadata` (JSONB) and per-message intent on
 * `Message.metadata` — no schema migration is required.
 */

export type ConversationIntent =
  'question' | 'task' | 'chitchat' | 'followup' | 'continuation' | 'clarification';

/** Conversations at/above this many messages become candidates for a summary. */
export const SUMMARY_THRESHOLD = 20;
/** Re-summarize only once this many new messages have accumulated. */
export const SUMMARY_STEP = 10;
/** Full history messages kept verbatim in the prompt window. */
export const CONTEXT_RECENT_LIMIT = 30;
/** Memories fetched from the store before ranking. */
export const MEMORY_FETCH_LIMIT = 100;
/** Memories actually injected into the system prompt after relevance ranking. */
export const MEMORY_RANK_TOP_K = 8;
/** Rough transcript cap for a summarization request. */
export const SUMMARY_MAX_LENGTH = 12_000;
/** Target length of a rolling summary. */
export const SUMMARY_WORDS = 150;
/** Max follow-up suggestions surfaced per assistant reply. */
export const FOLLOWUP_MAX = 2;
/** Conversation auto-title length cap. */
export const TITLE_MAX = 60;

export type ConversationState = {
  engineVersion: number;
  /** Rolling summary of the older part of the conversation. */
  summary?: string;
  /** Number of messages already folded into `summary`. */
  summaryMessageCount: number;
  /** Unfinished task the model was working on when it ran out of rounds. */
  pendingTask?: string;
  /** ISO timestamp for when the pending task was recorded. */
  pendingTaskAt?: string;
  /** Follow-up suggestions from the most recent assistant reply. */
  suggestions?: string[];
};

export type MessageState = {
  intent?: ConversationIntent;
};

export type HistoryEntry = {
  role: 'USER' | 'ASSISTANT' | 'SYSTEM';
  content: string;
};

export type MemoryFact = {
  key: string;
  value: string;
  category: string | null;
  updatedAt?: Date;
};

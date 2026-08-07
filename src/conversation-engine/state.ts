import { isIntent } from './intent.js';
import type { ConversationState, MessageState } from './types.js';

export const CONVERSATION_STATE_VERSION = 1;
export const MESSAGE_STATE_VERSION = 1;

const DEFAULT_CONVERSATION_STATE: ConversationState = {
  engineVersion: CONVERSATION_STATE_VERSION,
  summaryMessageCount: 0,
};

const DEFAULT_MESSAGE_STATE: MessageState = {};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Parses a Conversation.metadata value (a Prisma JSON object, or the string
 * form used by earlier versions) into a safe ConversationState.
 */
export function parseConversationState(raw: unknown): ConversationState {
  let parsed: unknown = raw;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return { ...DEFAULT_CONVERSATION_STATE };
    }
  }
  if (!isRecord(parsed)) {
    return { ...DEFAULT_CONVERSATION_STATE };
  }
  const state: ConversationState = {
    ...DEFAULT_CONVERSATION_STATE,
    engineVersion: CONVERSATION_STATE_VERSION,
  };
  if (typeof parsed.summary === 'string') {
    state.summary = parsed.summary;
  }
  if (typeof parsed.summaryMessageCount === 'number') {
    state.summaryMessageCount = parsed.summaryMessageCount;
  }
  if (typeof parsed.pendingTask === 'string') {
    state.pendingTask = parsed.pendingTask;
    if (typeof parsed.pendingTaskAt === 'string') {
      state.pendingTaskAt = parsed.pendingTaskAt;
    }
  }
  if (
    Array.isArray(parsed.suggestions) &&
    parsed.suggestions.every((item) => typeof item === 'string')
  ) {
    state.suggestions = parsed.suggestions;
  }
  return state;
}

/** Serializes a ConversationState for storage as a Prisma JSON value. */
export function serializeConversationState(state: ConversationState): Record<string, unknown> {
  return JSON.parse(JSON.stringify(state)) as Record<string, unknown>;
}

/** Parses a Message.metadata JSON value into a safe MessageState. */
export function parseMessageState(raw: unknown): MessageState {
  if (!isRecord(raw)) {
    return { ...DEFAULT_MESSAGE_STATE };
  }
  const state: MessageState = { ...DEFAULT_MESSAGE_STATE };
  if (isIntent(raw.intent)) {
    state.intent = raw.intent;
  }
  return state;
}

/** Serializes a MessageState for storage as a Prisma JSON value. */
export function serializeMessageState(state: MessageState): Record<string, unknown> {
  return { ...state };
}

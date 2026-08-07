import type { ConversationIntent } from './types.js';

const CONTINUATION_RE =
  /^(?:continue|go on|keep going|keep writing|proceed|resume|next|more|keep talking)(?:[,.!?]| please| with it|$)/i;
const CLARIFICATION_RE =
  /^(what|why|how|when|where|who|huh|wait|again|repeat|pardon|which one|sorry\?|say that again)([,.!?]|$)/i;
const CONNECTOR_RE = /^(what about|how about|what if|why not|and|but|also|so|then|or|instead)\b/i;
const GREETING_ONLY_RE =
  /^(hi|hey|hello|yo|sup|hiya|good morning|good afternoon|good evening|thanks|thank you|ok|okay|awesome|great|nice|cool|haha|lol|bye|goodbye|see you|thank you so much|thanks a lot)[,.!?\s]*$/i;
const INTERROGATIVE_RE =
  /^(what|why|how|when|where|who|which|whose|can|could|do|does|did|is|are|will|would|should|may|might|have|has)\b/i;
const IMPERATIVE_RE =
  /^(give|tell|show|create|make|build|write|find|search|run|execute|start|stop|send|call|list|set|remind|remind me|translate|summarize|calculate|check|open|close|add|remove|delete|update|install|configure|schedule|plan|draft|review|read|generate|convert|compare|explain|fix|debug|help me)\b/i;
const VAGUE_PRONOUN_RE = /\b(it|that|this|them|those|one|so|then|there|they)\b/i;

export function isIntent(value: unknown): value is ConversationIntent {
  return (
    value === 'question' ||
    value === 'task' ||
    value === 'chitchat' ||
    value === 'followup' ||
    value === 'continuation' ||
    value === 'clarification'
  );
}

/**
 * Classifies a user message into a coarse intent that the prompt builder and
 * the conversation state machine can act on. Deterministic and pure so it is
 * easy to test; heuristic by design — the LLM still decides *how* to answer.
 */
export function classifyIntent(message: string, lastAssistant?: string): ConversationIntent {
  const text = message.trim();

  if (CONTINUATION_RE.test(text)) {
    return 'continuation';
  }
  if (text.length <= 30 && CLARIFICATION_RE.test(text)) {
    return 'clarification';
  }
  // A terse answer right after the assistant asked a question is a clarification.
  if (lastAssistant && lastAssistant.includes('?') && text.length <= 12) {
    return 'clarification';
  }
  if (text.length <= 40 && CONNECTOR_RE.test(text)) {
    return 'followup';
  }
  if (text.length <= 30 && GREETING_ONLY_RE.test(text)) {
    return 'chitchat';
  }
  // Short, pronoun-heavy messages ("what about it?", "and this one?") build on
  // the previous turn, so keep the prior context injected.
  if (text.length <= 60 && lastAssistant && VAGUE_PRONOUN_RE.test(text)) {
    return 'followup';
  }
  if (text.includes('?') || INTERROGATIVE_RE.test(text)) {
    return 'question';
  }
  if (IMPERATIVE_RE.test(text)) {
    return 'task';
  }
  if (text.length <= 20) {
    return 'chitchat';
  }
  return 'task';
}

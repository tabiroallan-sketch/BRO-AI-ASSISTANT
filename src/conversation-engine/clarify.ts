import { FOLLOWUP_MAX } from './types.js';

/**
 * Detects whether the user's message is too vague to answer well. Only fires on
 * substantive, non-terse messages (terse messages are handled by intent.ts as
 * clarification) and never on bare confirmations like "yes".
 */
export function needsClarification(
  message: string,
  intent: string,
  hasStoredMemory: boolean,
): boolean {
  const text = message.trim();
  if (text.length < 6 || text.length > 200 || !text.includes(' ')) {
    return false;
  }
  if (intent !== 'task' && intent !== 'question') {
    return false;
  }
  if (/^(yes|no|ok|okay|sure|yeah|nope|fine|got it|thanks?|done|correct)\b/i.test(text)) {
    return false;
  }
  // A short message leaning on a vague pronoun ("fix it", "make that better")
  // is a red flag when we have no stored context to resolve it.
  if (text.length <= 60 && /\b(it|this|that|these|those)\b/i.test(text)) {
    return !hasStoredMemory;
  }
  return false;
}

const FOLLOWUP_PREFIX_RE =
  /^(?:->|>|•|·|\*|-|next\s*:|suggest\s*:|try\s*:|you could\s*:|you can\s*:|maybe\s*:|next\s+|suggest\s+|try\s+|maybe\s+)/i;

/** Strips a follow-up marker prefix; returns undefined for plain sentences. */
function stripFollowupPrefix(line: string): string | undefined {
  let current = line.trim();
  let stripped = false;
  let changed = true;
  while (changed) {
    changed = false;
    const before = current;
    current = current.replace(FOLLOWUP_PREFIX_RE, '').trim();
    if (current !== before) {
      stripped = true;
      changed = true;
    }
  }
  if (!stripped) {
    return undefined;
  }
  if (current.length > 3 && current.length <= 120) {
    return current;
  }
  return undefined;
}

/**
 * Extracts suggested follow-up questions from an assistant reply so the UI can
 * render one-tap chips. Prefers explicit "next/suggest/try" markers; falls back
 * to questions that end the reply, deduplicated and capped.
 */
export function extractFollowupCandidates(reply: string, max = FOLLOWUP_MAX): string[] {
  const candidates: string[] = [];
  for (const line of reply.split('\n')) {
    const cleaned = stripFollowupPrefix(line);
    if (cleaned) {
      candidates.push(cleaned);
    }
  }
  if (candidates.length === 0) {
    const questions = reply
      .split(/(?<=[.!?])\s+/)
      .filter((sentence) => sentence.trim().endsWith('?'));
    for (const sentence of questions.slice(-4)) {
      const cleaned = sentence.replace(/^[^a-z0-9]+/i, '').trim();
      if (cleaned.length > 3 && cleaned.length <= 120) {
        candidates.push(cleaned);
      }
    }
  }
  const unique: string[] = [];
  for (const candidate of candidates) {
    if (!unique.some((existing) => existing.toLowerCase() === candidate.toLowerCase())) {
      unique.push(candidate);
    }
  }
  return unique.slice(0, max);
}

/** Converts a follow-up question into a user turn ready for the model. */
export function formatFollowupAsUserMessage(followup: string): string {
  return followup;
}

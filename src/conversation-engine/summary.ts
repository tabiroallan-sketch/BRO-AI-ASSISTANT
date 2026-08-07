import { CONTEXT_RECENT_LIMIT, SUMMARY_STEP, SUMMARY_THRESHOLD, SUMMARY_WORDS } from './types.js';
import type { ConversationState, HistoryEntry } from './types.js';

/**
 * Picks the history window to send to the model: the most recent messages
 * verbatim (for conversational continuity) plus a rolling summary of the older
 * ones that have already been folded away.
 */
export function buildHistoryWindow(
  history: HistoryEntry[],
  state: ConversationState,
): { recent: HistoryEntry[]; summary: string | undefined; summarizedCount: number } {
  return {
    recent: history.slice(-CONTEXT_RECENT_LIMIT),
    summary: state.summary,
    summarizedCount: state.summaryMessageCount,
  };
}

/** Number of messages already covered by the rolling summary. */
export function summarizedMessageCount(state: ConversationState): number {
  return state.summaryMessageCount;
}

/**
 * True once the conversation has grown enough past the last summary that
 * re-summarizing is worth the tokens. Always false when history is short or
 * nothing has been summarized yet.
 */
export function shouldSummarize(
  state: ConversationState,
  historyLength: number,
  threshold = SUMMARY_THRESHOLD,
  step = SUMMARY_STEP,
): boolean {
  if (state.summaryMessageCount === 0) {
    return historyLength >= threshold;
  }
  return historyLength - state.summaryMessageCount >= step;
}

/**
 * Builds the transcript text handed to the summarizer. Cuts the tail of the
 * oldest messages so the request stays within a token budget.
 */
export function buildSummaryInput(
  history: HistoryEntry[],
  state: ConversationState,
  maxLength = 12_000,
): string {
  const summarizedCount = state.summaryMessageCount;
  const tail = history.slice(summarizedCount);
  const transcript = tail
    .map((entry) => {
      const role = entry.role === 'SYSTEM' ? 'ASSISTANT' : entry.role;
      return `${role}: ${entry.content}`;
    })
    .join('\n');
  const truncated = transcript.length > maxLength ? transcript.slice(-maxLength) : transcript;
  return truncated;
}

/**
 * Normalizes a summarizer response into a compact rolling summary. A fresh
 * summary keeps the old content in a single condensed line.
 */
export function normalizeSummary(raw: string, previous: string | undefined): string {
  const cleaned = raw.trim();
  if (!cleaned) {
    return previous ?? '';
  }
  if (previous && cleaned.length <= SUMMARY_WORDS * 3) {
    return `${previous}\n${cleaned}`.trim();
  }
  return cleaned;
}

/** True when the summary text is non-empty. */
export function hasSummary(state: ConversationState): boolean {
  return Boolean(state.summary);
}

import { formatMemories } from './memory-recall.js';
import { formatTaskReminder } from './task.js';
import { buildHistoryWindow } from './summary.js';
import type { ConversationIntent, ConversationState, HistoryEntry, MemoryFact } from './types.js';

export type ContextBlock = {
  summary?: string;
  memories: MemoryFact[];
  taskReminder?: string;
  intent: ConversationIntent;
  intentInstruction?: string;
};

/**
 * Assembles the context block injected into the system prompt: rolling summary,
 * top relevant memories, an unfinished-task reminder, and an intent hint that
 * keeps the model focused on the current turn.
 */
export function buildContextBlock(
  history: HistoryEntry[],
  state: ConversationState,
  memories: MemoryFact[],
  intent: ConversationIntent,
  intentInstruction?: string,
): ContextBlock {
  const { summary } = buildHistoryWindow(history, state);
  return {
    summary,
    memories,
    taskReminder: formatTaskReminder(state),
    intent,
    ...(intentInstruction ? { intentInstruction } : {}),
  };
}

export function formatContextBlock(
  block: Omit<ContextBlock, 'intent'> & { intent?: ConversationIntent },
): string {
  const lines: string[] = [];
  if (block.summary) {
    lines.push('Earlier in this conversation (condensed summary):');
    lines.push(block.summary);
  }
  if (block.memories.length > 0) {
    lines.push('Things you remember about the user (use only if relevant):');
    lines.push(formatMemories(block.memories));
  }
  if (block.taskReminder) {
    lines.push(block.taskReminder);
  }
  if (block.intent) {
    lines.push(`Intent of the user's latest message: ${block.intent}.`);
  }
  if (block.intentInstruction) {
    lines.push(block.intentInstruction);
  }
  return lines.join('\n');
}

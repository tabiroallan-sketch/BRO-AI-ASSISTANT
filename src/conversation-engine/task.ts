import type { ConversationState } from './types.js';

const MAX_TASK_DESCRIPTION = 200;

/**
 * Records an unfinished task when the assistant hit the tool-call limit. Kept
 * small and capped so it can ride along on the conversation metadata.
 */
export function recordPendingTask(
  state: ConversationState,
  lastUserMessage: string,
): ConversationState {
  return {
    ...state,
    pendingTask: lastUserMessage.trim().slice(0, MAX_TASK_DESCRIPTION),
    pendingTaskAt: new Date().toISOString(),
  };
}

/**
 * Clears the pending task once the user moves on, has it resolved, or enough
 * turns have passed that the reminder would be stale.
 */
export function clearPendingTask(
  state: ConversationState,
  currentTurn: number,
  isContinuation: boolean,
  maxStaleTurns = 8,
): ConversationState {
  if (!state.pendingTask) {
    return state;
  }
  if (isContinuation) {
    return state;
  }
  if (currentTurn - state.summaryMessageCount > maxStaleTurns) {
    return { ...state, pendingTask: undefined, pendingTaskAt: undefined };
  }
  return { ...state, pendingTask: undefined, pendingTaskAt: undefined };
}

/**
 * True when the previous turn was left unfinished and the user is telling us
 * to carry on, so the reminder should stay injected.
 */
export function shouldContinueTask(state: ConversationState, isContinuation: boolean): boolean {
  return Boolean(isContinuation && state.pendingTask);
}

/**
 * Renders the task-reminder block that is appended to the system prompt.
 */
export function formatTaskReminder(state: ConversationState): string | undefined {
  if (!state.pendingTask) {
    return undefined;
  }
  return `The user was working on this task and may want to continue it: "${state.pendingTask}" — if the current message is a continuation, help finish it.`;
}

import { randomUUID } from 'node:crypto';

export type ConfirmationStatus = 'pending' | 'approved' | 'rejected' | 'expired';

export type PendingAction = {
  id: string;
  userId: string;
  toolName: string;
  args: Record<string, unknown>;
  summary: string;
  createdAt: string;
  expiresAt: string;
  status: ConfirmationStatus;
  decidedAt?: string;
  result?: string;
  /** Link back to the automation task/step that paused on this approval, when applicable. */
  taskId?: string;
  stepId?: string;
};

export type PendingActionInput = {
  userId: string;
  toolName: string;
  args: Record<string, unknown>;
  summary: string;
  taskId?: string;
  stepId?: string;
};

export const CONFIRMATION_TTL_MS = 10 * 60 * 1000;
const HISTORY_LIMIT_PER_USER = 50;

const actions = new Map<string, PendingAction>();
const order = new Map<string, number>();
let nextOrder = 0;

function keyOf(input: PendingActionInput): string {
  return `${input.toolName}:${JSON.stringify(input.args)}`;
}

export function createPendingAction(input: PendingActionInput): PendingAction {
  const now = Date.now();
  for (const action of actions.values()) {
    if (
      action.userId === input.userId &&
      action.status === 'pending' &&
      keyOf(action) === keyOf(input)
    ) {
      return action;
    }
  }
  const action: PendingAction = {
    id: randomUUID(),
    userId: input.userId,
    toolName: input.toolName,
    args: input.args,
    summary: input.summary,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + CONFIRMATION_TTL_MS).toISOString(),
    status: 'pending',
    ...(input.taskId ? { taskId: input.taskId } : {}),
    ...(input.stepId ? { stepId: input.stepId } : {}),
  };
  actions.set(action.id, action);
  order.set(action.id, nextOrder);
  nextOrder += 1;
  return action;
}

export function getPendingAction(id: string): PendingAction | undefined {
  return actions.get(id);
}

export function listActionsForUser(
  userId: string,
  limit = HISTORY_LIMIT_PER_USER,
): PendingAction[] {
  const clamped = Math.min(Math.max(Math.floor(limit), 1), 200);
  return [...actions.values()]
    .filter((action) => action.userId === userId)
    .sort((a, b) => {
      const byTime = b.createdAt.localeCompare(a.createdAt);
      return byTime !== 0 ? byTime : (order.get(b.id) ?? 0) - (order.get(a.id) ?? 0);
    })
    .slice(0, clamped);
}

/**
 * Resolves a pending action. Returns the updated action, or null when the
 * action is unknown / no longer pending. Expired actions are marked and
 * returned so callers can report the state change.
 */
export function decideAction(
  id: string,
  decision: 'approve' | 'reject',
  now: Date = new Date(),
): PendingAction | null {
  const action = actions.get(id);
  if (!action || action.status !== 'pending') {
    return null;
  }
  if (now.getTime() >= Date.parse(action.expiresAt)) {
    action.status = 'expired';
    action.decidedAt = now.toISOString();
    return action;
  }
  action.status = decision === 'approve' ? 'approved' : 'rejected';
  action.decidedAt = now.toISOString();
  return action;
}

export function markActionResult(id: string, result: string): PendingAction | undefined {
  const action = actions.get(id);
  if (action) {
    action.result = result;
  }
  return action;
}

export function expireStale(now: Date = new Date()): void {
  const current = now.getTime();
  for (const action of actions.values()) {
    if (action.status === 'pending' && current >= Date.parse(action.expiresAt)) {
      action.status = 'expired';
      action.decidedAt = now.toISOString();
    }
  }
}

export function confirmationCount(): number {
  return actions.size;
}

export function clearConfirmations(): void {
  actions.clear();
  order.clear();
  nextOrder = 0;
}

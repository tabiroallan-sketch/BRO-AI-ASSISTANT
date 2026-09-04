import { randomUUID } from 'node:crypto';
import type { AuditEvent } from '../lib/audit.js';
import type { PendingAction, PendingActionInput } from '../system/confirmation-store.js';
import type { Tool } from '../tools/types.js';
import type {
  AutomationEvent,
  AutomationStore,
  AutomationTask,
  AutomationStep,
  EventBus,
  TaskListQuery,
  TaskLogEntry,
  TaskOptions,
  TaskPlanner,
  TaskQueue,
  TaskSnapshot,
  ToolExecutor,
} from './types.js';

export const DEFAULT_MAX_RETRIES = 2;
export const DEFAULT_CONTINUE_ON_ERROR = false;
export const DEFAULT_NOTIFY_ON_COMPLETION = true;
export const DEFAULT_RETRY_DELAY_MS = 300;

export type AutomationEngineDeps = {
  store: AutomationStore;
  planner: TaskPlanner;
  executor: ToolExecutor;
  queue: TaskQueue;
  events: EventBus;
  listTools(): Tool[];
  recordAudit(event: Omit<AuditEvent, 'id' | 'at'>): AuditEvent;
  createPendingAction(
    input: PendingActionInput & { taskId?: string; stepId?: string },
  ): PendingAction;
  sleep(ms: number): Promise<void>;
  retryDelayMs?(attempt: number): number;
};

export type AutomationEngine = {
  createTask(input: {
    userId: string;
    title: string;
    goal: string;
    options?: TaskOptions;
  }): TaskSnapshot;
  getTask(id: string): TaskSnapshot | undefined;
  listTasks(userId: string, query?: TaskListQuery): TaskSnapshot[];
  cancel(id: string): boolean;
  retry(id: string): boolean;
  continueAfterDecision(input: {
    taskId: string;
    stepId: string;
    decision: 'approve' | 'reject';
    output?: string;
  }): void;
  onTaskEvent(listener: (event: AutomationEvent) => void): () => void;
  snapshot(task: AutomationTask): TaskSnapshot;
  clear(): void;
};

function normalizeOptions(options: TaskOptions = {}): Required<TaskOptions> {
  return {
    maxRetries: Math.min(Math.max(Math.floor(options.maxRetries ?? DEFAULT_MAX_RETRIES), 0), 10),
    continueOnError: options.continueOnError ?? DEFAULT_CONTINUE_ON_ERROR,
    notifyOnCompletion: options.notifyOnCompletion ?? DEFAULT_NOTIFY_ON_COMPLETION,
  };
}

const TERMINAL: TaskSnapshot['status'][] = ['completed', 'failed', 'cancelled'];

export function createAutomationEngine(deps: AutomationEngineDeps): AutomationEngine {
  const controllers = new Map<string, AbortController>();
  const queueIds = new Map<string, string>();
  const activeTasks = new Set<string>();

  const nowIso = (): string => new Date().toISOString();

  function log(level: TaskLogEntry['level'], message: string): TaskLogEntry {
    return { at: nowIso(), level, message };
  }

  function refresh(id: string): AutomationTask {
    return deps.store.getTask(id) as AutomationTask;
  }

  function snapshot(task: AutomationTask): TaskSnapshot {
    return {
      ...task,
      steps: task.steps.map((step) => ({ ...step })),
      logs: [...task.logs],
    };
  }

  function emit(id: string): void {
    deps.events.emit({ task: snapshot(refresh(id)) });
  }

  function appendLogs(id: string, entries: TaskLogEntry[]): void {
    const task = refresh(id);
    deps.store.updateTask(id, { logs: [...task.logs, ...entries] });
  }

  function markStep(id: string, stepId: string, patch: Partial<AutomationStep>): void {
    const task = refresh(id);
    deps.store.updateTask(id, {
      steps: task.steps.map((step) => (step.id === stepId ? { ...step, ...patch } : step)),
    });
  }

  function markCancelled(id: string, reason: string): void {
    const task = refresh(id);
    if (!task || TERMINAL.includes(task.status)) {
      return;
    }
    deps.store.updateTask(id, {
      status: 'cancelled',
      error: reason,
      finishedAt: nowIso(),
      logs: [...task.logs, log('info', reason)],
    });
    deps.recordAudit({
      actorId: task.userId,
      action: 'automation.task.cancel',
      target: id,
      detail: task.title,
    });
    emit(id);
  }

  function fail(id: string, message: string): void {
    const task = refresh(id);
    if (!task || TERMINAL.includes(task.status)) {
      return;
    }
    deps.store.updateTask(id, {
      status: 'failed',
      error: message,
      finishedAt: nowIso(),
      logs: [...task.logs, log('error', message)],
    });
    deps.recordAudit({
      actorId: task.userId,
      action: 'automation.task.failed',
      target: id,
      detail: message,
    });
    emit(id);
  }

  function complete(id: string): void {
    const task = refresh(id);
    if (!task || task.status !== 'running') {
      return;
    }
    deps.store.updateTask(id, {
      status: 'completed',
      finishedAt: nowIso(),
      logs: [...task.logs, log('info', 'Task completed')],
    });
    deps.recordAudit({
      actorId: task.userId,
      action: 'automation.task.complete',
      target: id,
      detail: task.title,
    });
    emit(id);
  }

  async function runLoop(id: string): Promise<void> {
    const initial = deps.store.getTask(id);
    if (!initial || (initial.status !== 'queued' && initial.status !== 'running')) {
      return;
    }
    if (!controllers.has(id)) {
      controllers.set(id, new AbortController());
    }
    const controller = controllers.get(id) as AbortController;
    const aborted = controller.signal;

    let task = refresh(id);

    if (task.status === 'queued') {
      deps.store.updateTask(id, { status: 'planning' });
      emit(id);
      task = refresh(id);
      const planned = await deps.planner.plan({ goal: task.goal }, { userId: task.userId });
      if (aborted.aborted) {
        markCancelled(id, 'Task cancelled');
        return;
      }
      if (planned.length === 0) {
        fail(id, 'No plan could be derived for this goal.');
        return;
      }
      deps.store.updateTask(id, {
        status: 'running',
        startedAt: nowIso(),
        currentStepIndex: 0,
        steps: planned.map((step, index): AutomationStep => ({
          ...step,
          id: randomUUID(),
          order: index,
          status: 'queued',
          attempts: 0,
        })),
        logs: [
          ...refresh(id).logs,
          log('info', `Planned ${planned.length} step(s)`),
          log('info', planned.map((s) => s.toolName).join(' → ')),
        ],
      });
      emit(id);
      task = refresh(id);
    }

    while (task.currentStepIndex < task.steps.length) {
      if (aborted.aborted) {
        markCancelled(id, 'Task cancelled');
        return;
      }
      const step = task.steps[task.currentStepIndex];
      if (!step) {
        break;
      }
      markStep(id, step.id, { status: 'running' });
      emit(id);

      const maxRetries = task.options.maxRetries;
      let result = await deps.executor.runStepOnce(step, { userId: task.userId });
      let attempts = 1;
      while (!result.needsConfirmation && !result.ok && attempts <= maxRetries) {
        const delay = (
          deps.retryDelayMs ?? ((attempt): number => attempt * DEFAULT_RETRY_DELAY_MS)
        )(attempts);
        await deps.sleep(delay);
        if (aborted.aborted) {
          markCancelled(id, 'Task cancelled');
          return;
        }
        result = await deps.executor.runStepOnce(step, { userId: task.userId });
        attempts += 1;
      }

      if (aborted.aborted) {
        markCancelled(id, 'Task cancelled');
        return;
      }

      if (result.needsConfirmation) {
        deps.createPendingAction({
          userId: task.userId,
          toolName: step.toolName,
          args: step.args,
          summary: result.summary,
          taskId: id,
          stepId: step.id,
        });
        markStep(id, step.id, { status: 'awaiting_confirmation', attempts });
        deps.store.updateTask(id, { status: 'awaiting_confirmation' });
        appendLogs(id, [
          log(
            'info',
            `Awaiting approval for step ${step.order + 1} (${step.toolName}): ${result.summary}`,
          ),
        ]);
        emit(id);
        return;
      }

      if (result.ok) {
        markStep(id, step.id, { status: 'completed', result: result.output, attempts });
        appendLogs(id, [log('info', `Step ${step.order + 1} (${step.toolName}) completed`)]);
        emit(id);
        deps.store.updateTask(id, { currentStepIndex: task.currentStepIndex + 1 });
        task = refresh(id);
        continue;
      }

      markStep(id, step.id, { status: 'failed', error: result.output, attempts });
      appendLogs(id, [
        log('error', `Step ${step.order + 1} (${step.toolName}) failed: ${result.output}`),
      ]);
      emit(id);
      if (task.options.continueOnError) {
        appendLogs(id, [log('warn', `Continuing after failed step ${step.order + 1}`)]);
        deps.store.updateTask(id, { currentStepIndex: task.currentStepIndex + 1 });
        task = refresh(id);
        continue;
      }
      fail(id, `Step ${step.order + 1} (${step.toolName}) failed: ${result.output}`);
      return;
    }

    if (aborted.aborted) {
      markCancelled(id, 'Task cancelled');
      return;
    }
    complete(id);
  }

  async function run(id: string): Promise<void> {
    if (activeTasks.has(id)) {
      return;
    }
    activeTasks.add(id);
    try {
      await runLoop(id);
    } finally {
      activeTasks.delete(id);
    }
  }

  function createTask(input: {
    userId: string;
    title: string;
    goal: string;
    options?: TaskOptions;
  }): TaskSnapshot {
    const task = deps.store.createTask({
      userId: input.userId,
      title: input.title,
      goal: input.goal,
      options: normalizeOptions(input.options),
    });
    deps.recordAudit({
      actorId: input.userId,
      action: 'automation.task.create',
      target: task.id,
      detail: task.title,
    });
    emit(task.id);
    const queueId = deps.queue.enqueue(() => run(task.id));
    queueIds.set(task.id, queueId);
    return snapshot(task);
  }

  function getTask(id: string): TaskSnapshot | undefined {
    const task = deps.store.getTask(id);
    return task ? snapshot(task) : undefined;
  }

  function listTasks(userId: string, query: TaskListQuery = {}): TaskSnapshot[] {
    return deps.store.listTasksForUser(userId, query).map(snapshot);
  }

  function cancel(id: string): boolean {
    const task = deps.store.getTask(id);
    if (!task || TERMINAL.includes(task.status)) {
      return false;
    }
    if (task.status === 'queued') {
      const queueId = queueIds.get(id);
      if (queueId) {
        deps.queue.cancel(queueId);
      }
      markCancelled(id, 'Task cancelled before it started');
      return true;
    }
    if (task.status === 'awaiting_confirmation') {
      markCancelled(id, 'Task cancelled while waiting for approval');
      return true;
    }
    controllers.get(id)?.abort();
    return true;
  }

  function retry(id: string): boolean {
    const task = deps.store.getTask(id);
    if (!task || !TERMINAL.includes(task.status)) {
      return false;
    }
    deps.store.updateTask(id, {
      status: 'queued',
      error: undefined,
      finishedAt: undefined,
      startedAt: undefined,
      currentStepIndex: 0,
      steps: task.steps.map((step) => ({
        ...step,
        status: 'queued',
        result: undefined,
        error: undefined,
        attempts: 0,
      })),
      logs: [...task.logs, log('info', 'Task queued for retry')],
    });
    deps.recordAudit({
      actorId: task.userId,
      action: 'automation.task.retry',
      target: id,
      detail: task.title,
    });
    const queueId = deps.queue.enqueue(() => run(id));
    queueIds.set(id, queueId);
    emit(id);
    return true;
  }

  function continueAfterDecision(input: {
    taskId: string;
    stepId: string;
    decision: 'approve' | 'reject';
    output?: string;
  }): void {
    const task = deps.store.getTask(input.taskId);
    if (!task || task.status !== 'awaiting_confirmation') {
      return;
    }
    const step = task.steps.find((candidate) => candidate.id === input.stepId);
    if (!step || step.status !== 'awaiting_confirmation') {
      return;
    }
    if (input.decision === 'reject') {
      markStep(input.taskId, input.stepId, { status: 'rejected', error: 'Rejected by user' });
      deps.store.updateTask(input.taskId, {
        status: 'failed',
        error: `Step ${step.order + 1} (${step.toolName}) was rejected by the user`,
        finishedAt: nowIso(),
        logs: [
          ...refresh(input.taskId).logs,
          log('error', `Step ${step.order + 1} (${step.toolName}) was rejected by the user`),
        ],
      });
      deps.recordAudit({
        actorId: task.userId,
        action: 'automation.task.failed',
        target: input.taskId,
        detail: `${task.title} — step rejected`,
      });
      emit(input.taskId);
      return;
    }
    markStep(input.taskId, input.stepId, {
      status: 'completed',
      result: input.output ?? '',
      attempts: step.attempts + 1,
    });
    deps.store.updateTask(input.taskId, {
      status: 'running',
      currentStepIndex: step.order + 1,
      logs: [
        ...refresh(input.taskId).logs,
        log('info', `Step ${step.order + 1} (${step.toolName}) approved`),
      ],
    });
    emit(input.taskId);
    void run(input.taskId);
  }

  function clear(): void {
    deps.store.clear();
    controllers.clear();
    queueIds.clear();
    activeTasks.clear();
    deps.queue.clear();
  }

  return {
    createTask,
    getTask,
    listTasks,
    cancel,
    retry,
    continueAfterDecision,
    onTaskEvent: deps.events.subscribe,
    snapshot,
    clear,
  };
}

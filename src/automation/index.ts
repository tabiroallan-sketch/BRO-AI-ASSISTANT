import { config } from '../config/index.js';
import { runCompletion } from '../conversation-engine/index.js';
import { sleep } from '../llm/utils/retry.js';
import { recordAudit } from '../lib/audit.js';
import { validateToolOutput } from '../lib/output-validate.js';
import { prisma } from '../lib/prisma.js';
import { createPendingAction } from '../system/confirmation-store.js';
import { describeAction } from '../system/describe.js';
import { getTool, listTools } from '../tools/registry.js';
import { createAutomationEngine } from './engine.js';
import { createEventBus } from './events.js';
import { createToolExecutor } from './executor.js';
import { createFallbackPlanner } from './planner.js';
import { createTaskQueue } from './queue.js';
import { createAutomationStore } from './store.js';
import type { TaskSnapshot } from './types.js';

export type * from './types.js';

const store = createAutomationStore({ maxTasksPerUser: config.automationMaxTasksPerUser });
const queue = createTaskQueue({ concurrency: config.automationQueueConcurrency });
const events = createEventBus();
const planner = createFallbackPlanner({
  runCompletion: (request) => runCompletion(request),
  getTools: listTools,
});
const executor = createToolExecutor({
  getTool,
  validateOutput: validateToolOutput,
  describeAction,
});

export const automationEngine = createAutomationEngine({
  store,
  queue,
  events,
  planner,
  executor,
  listTools,
  recordAudit,
  createPendingAction,
  sleep,
});

events.subscribe(({ task }) => {
  if (!task.options.notifyOnCompletion || !task.userId) {
    return;
  }
  if (task.status !== 'completed' && task.status !== 'failed' && task.status !== 'cancelled') {
    return;
  }
  void createTaskNotification(task);
});

function createTaskNotification(task: TaskSnapshot): Promise<unknown> {
  if (!prisma || typeof prisma.notification?.create !== 'function') {
    return Promise.resolve();
  }
  const prefix =
    task.status === 'completed'
      ? 'Task completed'
      : task.status === 'failed'
        ? 'Task failed'
        : 'Task cancelled';
  const body =
    task.status === 'completed'
      ? `${task.steps.length} step(s) ran successfully.`
      : (task.error ?? task.goal);
  return prisma.notification
    .create({ data: { userId: task.userId, title: `${prefix}: ${task.title}`, body } })
    .catch(() => undefined);
}

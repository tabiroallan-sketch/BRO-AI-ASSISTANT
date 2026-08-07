import { randomUUID } from 'node:crypto';
import type { AutomationStore, AutomationTask, TaskListQuery } from './types.js';

const TERMINAL_STATUSES: AutomationTask['status'][] = ['completed', 'failed', 'cancelled'];

/**
 * In-memory task store with a per-user retention cap. Old terminal tasks are
 * evicted first so the dashboard never grows unbounded.
 */
export function createAutomationStore(options: { maxTasksPerUser?: number } = {}): AutomationStore {
  const maxTasksPerUser = Math.max(options.maxTasksPerUser ?? 100, 1);
  const tasks = new Map<string, AutomationTask>();
  const perUser = new Map<string, string[]>();

  function evict(userId: string): void {
    const ids = perUser.get(userId) ?? [];
    while (ids.length > maxTasksPerUser) {
      const oldest = ids.find((candidate) => {
        const task = tasks.get(candidate);
        return task ? TERMINAL_STATUSES.includes(task.status) : false;
      });
      if (!oldest) {
        break;
      }
      ids.splice(ids.indexOf(oldest), 1);
      tasks.delete(oldest);
    }
  }

  return {
    createTask(input) {
      const now = new Date().toISOString();
      const task: AutomationTask = {
        id: randomUUID(),
        userId: input.userId,
        title: input.title,
        goal: input.goal,
        status: 'queued',
        options: input.options,
        createdAt: now,
        currentStepIndex: 0,
        steps: [],
        logs: [{ at: now, level: 'info', message: 'Task queued' }],
      };
      tasks.set(task.id, task);
      const ids = perUser.get(task.userId) ?? [];
      ids.push(task.id);
      perUser.set(task.userId, ids);
      evict(task.userId);
      return task;
    },
    getTask(id) {
      return tasks.get(id);
    },
    listTasksForUser(userId, query: TaskListQuery = {}) {
      const limit = Math.min(Math.max(Math.floor(query.limit ?? 50), 1), 200);
      return (perUser.get(userId) ?? [])
        .map((id) => tasks.get(id))
        .filter((task): task is AutomationTask => Boolean(task))
        .filter((task) => (query.status ? task.status === query.status : true))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, limit);
    },
    updateTask(id, patch) {
      const task = tasks.get(id);
      if (!task) {
        return undefined;
      }
      const updated: AutomationTask = {
        ...task,
        ...patch,
        steps: patch.steps ?? task.steps,
        logs: patch.logs ?? task.logs,
      };
      tasks.set(id, updated);
      return updated;
    },
    clear() {
      tasks.clear();
      perUser.clear();
    },
  };
}

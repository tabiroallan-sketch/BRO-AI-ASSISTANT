import { randomUUID } from 'node:crypto';
import type { Runnable, TaskQueue } from './types.js';

/**
 * FIFO task queue that runs at most `concurrency` runnables at a time. Queued
 * entries can be cancelled before they start; running entries are unaffected.
 */
export function createTaskQueue(options: { concurrency?: number } = {}): TaskQueue {
  const concurrency = Math.max(Math.floor(options.concurrency ?? 1), 1);
  const entries = new Map<string, Runnable>();
  const order: string[] = [];
  let active = 0;

  function pump(): void {
    while (active < concurrency && order.length > 0) {
      const id = order.shift();
      if (id === undefined) {
        break;
      }
      const runnable = entries.get(id);
      entries.delete(id);
      if (!runnable) {
        continue;
      }
      active += 1;
      void runnable()
        .catch(() => undefined)
        .finally(() => {
          active -= 1;
          pump();
        });
    }
  }

  return {
    enqueue(runnable) {
      const id = randomUUID();
      entries.set(id, runnable);
      order.push(id);
      pump();
      return id;
    },
    cancel(id) {
      if (!entries.has(id)) {
        return false;
      }
      entries.delete(id);
      const index = order.indexOf(id);
      if (index >= 0) {
        order.splice(index, 1);
      }
      return true;
    },
    get size() {
      return entries.size;
    },
    get pending() {
      return order.length;
    },
    get running() {
      return active;
    },
    clear() {
      entries.clear();
      order.length = 0;
    },
  };
}

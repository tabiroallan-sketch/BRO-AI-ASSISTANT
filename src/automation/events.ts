import type { AutomationEvent, EventBus } from './types.js';

export function createEventBus(): EventBus {
  const listeners = new Set<(event: AutomationEvent) => void>();

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    emit(event) {
      for (const listener of listeners) {
        try {
          listener(event);
        } catch {
          // A faulty listener must not break the engine loop.
        }
      }
    },
    clear() {
      listeners.clear();
    },
  };
}

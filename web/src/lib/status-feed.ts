import { create } from 'zustand';

export type StatusLevel = 'info' | 'success' | 'warning' | 'error';

export interface StatusEvent {
  id: string;
  level: StatusLevel;
  title: string;
  detail?: string;
  createdAt: number;
}

const MAX_EVENTS = 50;

let nextId = 0;

type StatusFeedState = {
  events: StatusEvent[];
  unread: number;
  push: (level: StatusLevel, title: string, detail?: string) => string;
  dismiss: (id: string) => void;
  dismissAll: () => void;
  markRead: () => void;
};

/**
 * Client-side system status feed: AI state transitions and system events are
 * recorded here and surface as toasts and in the status floating panel.
 * Kept separate from the backend notification system (which stays untouched).
 */
export const useStatusFeed = create<StatusFeedState>((set) => ({
  events: [],
  unread: 0,
  push: (level, title, detail) => {
    const id = `status-${++nextId}`;
    set((state) => ({
      events: [{ id, level, title, detail, createdAt: Date.now() }, ...state.events].slice(
        0,
        MAX_EVENTS,
      ),
      unread: state.unread + 1,
    }));
    return id;
  },
  dismiss: (id) => set((state) => ({ events: state.events.filter((event) => event.id !== id) })),
  dismissAll: () => set({ events: [] }),
  markRead: () => set({ unread: 0 }),
}));

export function formatStatusTime(createdAt: number): string {
  const seconds = Math.floor((Date.now() - createdAt) / 1000);
  if (seconds < 5) {
    return 'now';
  }
  if (seconds < 60) {
    return `${seconds}s ago`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

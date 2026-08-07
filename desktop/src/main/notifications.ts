import { Notification } from 'electron';

/**
 * Native notifications (Windows toast). Thin wrapper so callers never touch
 * Electron directly and so tests can assert via injected spies.
 */
export type Notifier = {
  show(title: string, body: string): void;
  isSupported(): boolean;
};

export type NotifierOptions = {
  showFn?: (title: string, body: string) => void;
};

export function createNotifier(options: NotifierOptions = {}): Notifier {
  const showFn =
    options.showFn ??
    ((title: string, body: string) => {
      if (Notification.isSupported()) {
        new Notification({ title, body }).show();
      }
    });
  return {
    show: (title, body) => showFn(title, body),
    isSupported: () => Notification.isSupported(),
  };
}

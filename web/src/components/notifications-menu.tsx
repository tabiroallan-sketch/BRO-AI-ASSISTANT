'use client';

import * as React from 'react';
import { Bell } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type Notification,
} from '@/lib/notifications';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

function formatRelativeTime(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function NotificationsMenu(): React.JSX.Element | null {
  const router = useRouter();
  const { logout } = useAuth();
  const [open, setOpen] = React.useState(false);
  const [notifications, setNotifications] = React.useState<Notification[]>([]);
  const [unread, setUnread] = React.useState(0);
  const [error, setError] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  async function load(): Promise<void> {
    try {
      const result = await listNotifications();
      setNotifications(result.notifications);
      setUnread(result.unreadCount);
      setError(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        await logout();
        router.replace('/login');
        return;
      }
      setError(true);
    }
  }

  React.useEffect(() => {
    void load();
    const interval = setInterval(() => void load(), 30000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (!open) return;
    function handleClickOutside(event: MouseEvent): void {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  async function handleOpen(): Promise<void> {
    const next = !open;
    setOpen(next);
    if (next) {
      await load();
    }
  }

  async function handleRead(id: string): Promise<void> {
    await markNotificationRead(id).catch(() => undefined);
    setUnread((current) => Math.max(0, current - 1));
    setNotifications((current) =>
      current.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)),
    );
  }

  async function handleReadAll(): Promise<void> {
    await markAllNotificationsRead().catch(() => undefined);
    setUnread(0);
    setNotifications((current) =>
      current.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })),
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <Button
        variant="ghost"
        size="icon"
        aria-label="Notifications"
        className="relative"
        onClick={() => void handleOpen()}
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </Button>
      {open && (
        <div className="absolute right-0 top-9 z-50 w-80 overflow-hidden rounded-lg border bg-background shadow-lg">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <span className="text-sm font-semibold">Notifications</span>
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground"
              onClick={() => void handleReadAll()}
            >
              Mark all read
            </button>
          </div>
          <div className="max-h-80 overflow-y-auto">
            {error ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                Failed to load notifications.
              </p>
            ) : notifications.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                No notifications yet.
              </p>
            ) : (
              notifications.map((notification) => (
                <button
                  key={notification.id}
                  type="button"
                  className={cn(
                    'flex w-full flex-col gap-0.5 border-b px-3 py-2.5 text-left transition-colors hover:bg-accent',
                    notification.readAt === null && 'bg-accent/40',
                  )}
                  onClick={() => void handleRead(notification.id)}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">{notification.title}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatRelativeTime(notification.createdAt)}
                    </span>
                  </span>
                  {notification.body && (
                    <span className="text-xs text-muted-foreground">{notification.body}</span>
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { CheckCheck, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import { DashboardPageHeader } from '@/components/dashboard-page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  deleteNotification,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  notificationKindLabel,
  NOTIFICATION_KINDS,
  NOTIFICATION_PRIORITIES,
  type Notification,
  type NotificationKind,
  type NotificationPriority,
} from '@/lib/notifications';
import { cn } from '@/lib/utils';

type KindFilter = NotificationKind | 'all';
type PriorityFilter = NotificationPriority | 'all';

function priorityVariant(
  priority: NotificationPriority,
): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (priority) {
    case 'critical':
      return 'destructive';
    case 'high':
      return 'default';
    case 'medium':
      return 'secondary';
    case 'low':
      return 'outline';
  }
}

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

export default function NotificationsPage(): React.JSX.Element {
  const router = useRouter();
  const { logout } = useAuth();
  const [notifications, setNotifications] = React.useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = React.useState(0);
  const [loaded, setLoaded] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [kind, setKind] = React.useState<KindFilter>('all');
  const [priority, setPriority] = React.useState<PriorityFilter>('all');
  const [unreadOnly, setUnreadOnly] = React.useState(false);
  const [refreshing, setRefreshing] = React.useState(false);

  const load = React.useCallback(
    async (signal?: AbortSignal): Promise<void> => {
      try {
        const result = await listNotifications({
          limit: 100,
          ...(kind !== 'all' ? { kind } : {}),
          ...(priority !== 'all' ? { priority } : {}),
          ...(unreadOnly ? { unread: true } : {}),
        });
        if (signal?.aborted) {
          return;
        }
        setNotifications(result.notifications);
        setUnreadCount(result.unreadCount);
        setError(null);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          await logout();
          router.replace('/login');
          return;
        }
        if (!signal?.aborted) {
          setError('Failed to load notifications.');
        }
      } finally {
        if (!signal?.aborted) {
          setLoaded(true);
          setRefreshing(false);
        }
      }
    },
    [kind, priority, unreadOnly, logout, router],
  );

  React.useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    const interval = setInterval(() => void load(controller.signal), 30000);
    return () => {
      clearInterval(interval);
      controller.abort();
    };
  }, [load]);

  async function handleRefresh(): Promise<void> {
    setRefreshing(true);
    await load();
  }

  async function handleRead(id: string): Promise<void> {
    await markNotificationRead(id).catch(() => undefined);
    setUnreadCount((current) => Math.max(0, current - 1));
    setNotifications((current) =>
      current.map((notification) =>
        notification.id === id
          ? { ...notification, readAt: new Date().toISOString() }
          : notification,
      ),
    );
  }

  async function handleReadAll(): Promise<void> {
    await markAllNotificationsRead().catch(() => undefined);
    setUnreadCount(0);
    setNotifications((current) =>
      current.map((notification) => ({
        ...notification,
        readAt: notification.readAt ?? new Date().toISOString(),
      })),
    );
  }

  async function handleDelete(id: string): Promise<void> {
    await deleteNotification(id).catch(() => undefined);
    setNotifications((current) => current.filter((notification) => notification.id !== id));
  }

  return (
    <div>
      <DashboardPageHeader
        title="Notifications"
        description="Review proactive alerts and mark them read or remove them."
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select
          aria-label="Filter by kind"
          className="rounded-md border border-input bg-transparent px-2 py-1.5 text-sm"
          value={kind}
          onChange={(event) => setKind(event.target.value as KindFilter)}
        >
          <option value="all">All kinds</option>
          {NOTIFICATION_KINDS.map((value) => (
            <option key={value} value={value}>
              {notificationKindLabel(value)}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter by priority"
          className="rounded-md border border-input bg-transparent px-2 py-1.5 text-sm"
          value={priority}
          onChange={(event) => setPriority(event.target.value as PriorityFilter)}
        >
          <option value="all">All priorities</option>
          {NOTIFICATION_PRIORITIES.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={unreadOnly}
            onChange={(event) => setUnreadOnly(event.target.checked)}
          />
          Unread only
        </label>
        <div className="flex-1" />
        <Button
          variant="outline"
          size="sm"
          onClick={() => void handleRefresh()}
          disabled={refreshing}
        >
          {refreshing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          Refresh
        </Button>
        <Button variant="outline" size="sm" onClick={() => void handleReadAll()}>
          <CheckCheck className="h-4 w-4" />
          Mark all read
        </Button>
      </div>

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      {!loaded ? (
        <div className="flex min-h-[30vh] items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : notifications.length === 0 ? (
        <div className="rounded-lg border bg-card py-16 text-center">
          <p className="text-sm text-muted-foreground">
            {unreadCount > 0 ? 'No notifications match these filters.' : 'No notifications yet.'}
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {notifications.map((notification) => {
            const unread = notification.readAt === null;
            return (
              <li
                key={notification.id}
                className={cn(
                  'flex items-start gap-3 rounded-lg border bg-card p-3 transition-colors',
                  unread && 'border-neon-cyan/40 bg-neon-cyan/5',
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={cn(
                        'text-sm font-medium',
                        unread ? 'text-foreground' : 'text-muted-foreground',
                      )}
                    >
                      {notification.title}
                    </span>
                    <Badge variant={priorityVariant(notification.priority)}>
                      {notification.priority}
                    </Badge>
                    <Badge variant="outline">{notificationKindLabel(notification.kind)}</Badge>
                  </div>
                  {notification.body && (
                    <p className="mt-1 text-xs text-muted-foreground">{notification.body}</p>
                  )}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatRelativeTime(notification.createdAt)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {unread && (
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Mark ${notification.title} as read`}
                      onClick={() => void handleRead(notification.id)}
                    >
                      Mark read
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Delete ${notification.title}`}
                    onClick={() => void handleDelete(notification.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

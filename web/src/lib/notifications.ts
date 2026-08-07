import { request } from '@/lib/api';
import { getAccessToken } from '@/lib/token-store';

export const NOTIFICATION_KINDS = [
  'build',
  'dev_server',
  'http',
  'low_disk',
  'high_cpu',
  'email',
  'calendar',
  'github',
  'automation',
  'system',
  'general',
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const NOTIFICATION_PRIORITIES = ['low', 'medium', 'high', 'critical'] as const;
export type NotificationPriority = (typeof NOTIFICATION_PRIORITIES)[number];

export type Notification = {
  id: string;
  title: string;
  body: string | null;
  kind: NotificationKind | null;
  priority: NotificationPriority;
  metadata: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
};

export type NotificationsResponse = {
  notifications: Notification[];
  unreadCount: number;
};

export type ListNotificationsQuery = {
  limit?: number;
  kind?: NotificationKind;
  priority?: NotificationPriority;
  unread?: boolean;
};

export function isNotificationKind(value: unknown): value is NotificationKind {
  return typeof value === 'string' && (NOTIFICATION_KINDS as readonly string[]).includes(value);
}

export function isNotificationPriority(value: unknown): value is NotificationPriority {
  return (
    typeof value === 'string' && (NOTIFICATION_PRIORITIES as readonly string[]).includes(value)
  );
}

export function notificationKindLabel(kind: NotificationKind | null): string {
  switch (kind) {
    case 'build':
      return 'Build';
    case 'dev_server':
      return 'Dev server';
    case 'http':
      return 'HTTP';
    case 'low_disk':
      return 'Disk';
    case 'high_cpu':
      return 'CPU';
    case 'email':
      return 'Email';
    case 'calendar':
      return 'Calendar';
    case 'github':
      return 'GitHub';
    case 'automation':
      return 'Automation';
    case 'system':
      return 'System';
    case 'general':
      return 'General';
    case null:
      return 'General';
  }
}

function authToken(): string {
  const token = getAccessToken();
  if (!token) {
    throw new Error('Not authenticated');
  }
  return token;
}

export async function listNotifications(
  query: ListNotificationsQuery = {},
): Promise<NotificationsResponse> {
  const params = new URLSearchParams();
  if (query.limit !== undefined) {
    params.set('limit', String(query.limit));
  }
  if (query.kind !== undefined) {
    params.set('kind', query.kind);
  }
  if (query.priority !== undefined) {
    params.set('priority', query.priority);
  }
  if (query.unread === true) {
    params.set('unread', 'true');
  }
  const search = params.toString();
  return request<NotificationsResponse>(`/notifications${search ? `?${search}` : ''}`, {
    token: authToken(),
  });
}

export async function markNotificationRead(id: string): Promise<void> {
  await request<void>(`/notifications/${id}/read`, {
    method: 'PATCH',
    token: authToken(),
  });
}

export async function markAllNotificationsRead(): Promise<void> {
  await request<void>('/notifications/read-all', {
    method: 'POST',
    token: authToken(),
  });
}

export async function deleteNotification(id: string): Promise<void> {
  await request<void>(`/notifications/${id}`, {
    method: 'DELETE',
    token: authToken(),
  });
}

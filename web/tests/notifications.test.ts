vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = 'http://test.local/api/v1';
});

const store = new Map<string, string>();

globalThis.localStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => {
    store.set(key, value);
  },
  removeItem: (key: string) => {
    store.delete(key);
  },
} as unknown as Storage;

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deleteNotification,
  isNotificationKind,
  isNotificationPriority,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  notificationKindLabel,
  NOTIFICATION_KINDS,
  NOTIFICATION_PRIORITIES,
  type Notification,
} from '@/lib/notifications';
import { setTokens } from '@/lib/token-store';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function notification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: 'notification-1',
    title: 'Build failed',
    body: 'npm run build exited with code 1',
    kind: 'build',
    priority: 'high',
    metadata: { dedupeKey: 'build:repo' },
    readAt: null,
    createdAt: '2026-08-07T00:00:00.000Z',
    ...overrides,
  };
}

describe('notifications client', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    setTokens('access-token', 'refresh-token');
  });

  it('lists notifications without query params by default', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ notifications: [notification()], unreadCount: 1 }));

    const result = await listNotifications();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://test.local/api/v1/notifications');
    expect(init.headers).toMatchObject({ authorization: 'Bearer access-token' });
    expect(result.notifications).toHaveLength(1);
    expect(result.unreadCount).toBe(1);
  });

  it('passes filters as query params', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ notifications: [], unreadCount: 0 }));

    await listNotifications({ kind: 'build', priority: 'high', unread: true, limit: 25 });

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'http://test.local/api/v1/notifications?limit=25&kind=build&priority=high&unread=true',
    );
  });

  it('marks a notification as read via PATCH', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await markNotificationRead('notification-1');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://test.local/api/v1/notifications/notification-1/read');
    expect(init.method).toBe('PATCH');
  });

  it('marks all notifications as read via POST', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await markAllNotificationsRead();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://test.local/api/v1/notifications/read-all');
    expect(init.method).toBe('POST');
  });

  it('deletes a notification via DELETE', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await deleteNotification('notification-1');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://test.local/api/v1/notifications/notification-1');
    expect(init.method).toBe('DELETE');
  });
});

describe('notification guards and labels', () => {
  it('exposes the supported kind and priority lists', () => {
    expect(NOTIFICATION_KINDS).toContain('build');
    expect(NOTIFICATION_KINDS).toContain('github');
    expect(NOTIFICATION_PRIORITIES).toEqual(['low', 'medium', 'high', 'critical']);
  });

  it('validates kinds', () => {
    expect(isNotificationKind('build')).toBe(true);
    expect(isNotificationKind('calendar')).toBe(true);
    expect(isNotificationKind('nope')).toBe(false);
    expect(isNotificationKind(42)).toBe(false);
  });

  it('validates priorities', () => {
    expect(isNotificationPriority('critical')).toBe(true);
    expect(isNotificationPriority('low')).toBe(true);
    expect(isNotificationPriority('urgent')).toBe(false);
    expect(isNotificationPriority(null)).toBe(false);
  });

  it('maps kinds to human labels', () => {
    expect(notificationKindLabel('dev_server')).toBe('Dev server');
    expect(notificationKindLabel('high_cpu')).toBe('CPU');
    expect(notificationKindLabel('github')).toBe('GitHub');
    expect(notificationKindLabel(null)).toBe('General');
  });
});

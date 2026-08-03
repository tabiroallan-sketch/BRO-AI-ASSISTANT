import { request } from '@/lib/api';
import { getAccessToken } from '@/lib/token-store';

export type Notification = {
  id: string;
  title: string;
  body: string | null;
  readAt: string | null;
  createdAt: string;
};

export type NotificationsResponse = {
  notifications: Notification[];
  unreadCount: number;
};

function authToken(): string {
  const token = getAccessToken();
  if (!token) {
    throw new Error('Not authenticated');
  }
  return token;
}

export async function listNotifications(): Promise<NotificationsResponse> {
  return request<NotificationsResponse>('/notifications', {
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

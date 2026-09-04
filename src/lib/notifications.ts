import type { NotificationKind, NotificationPriority } from '../proactive/types.js';
import { prisma } from './prisma.js';

export type CreateNotificationInput = {
  userId: string;
  title: string;
  body?: string | null;
  kind?: NotificationKind;
  priority?: NotificationPriority;
  metadata?: Record<string, unknown>;
};

/**
 * Best-effort in-app notification creation. Silently no-ops when the database
 * is not configured so callers never need to guard for it.
 */
export async function notify(input: CreateNotificationInput): Promise<void> {
  if (!prisma || typeof prisma.notification?.create !== 'function') {
    return;
  }
  try {
    await prisma.notification.create({
      data: {
        userId: input.userId,
        title: input.title,
        body: input.body ?? null,
        kind: input.kind ?? 'general',
        priority: input.priority ?? 'medium',
        metadata: (input.metadata ?? {}) as never,
      },
    });
  } catch {
    // Notifications are best-effort and must never break the underlying operation.
  }
}

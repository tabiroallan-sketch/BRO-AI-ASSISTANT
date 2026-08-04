import { randomUUID } from 'node:crypto';
import { config } from '../config/index.js';
import { redactText } from './secrets.js';

export type AuditAction =
  | 'auth.register'
  | 'auth.login'
  | 'auth.logout'
  | 'auth.refresh'
  | 'auth.oauth'
  | 'admin.user.update'
  | 'plugins.reload';

export type AuditEvent = {
  id: string;
  at: string;
  actorId?: string;
  actorEmail?: string;
  action: AuditAction;
  target?: string;
  detail?: string;
  ip?: string;
  userAgent?: string;
};

const events: AuditEvent[] = [];

export function recordAudit(event: Omit<AuditEvent, 'id' | 'at'>): AuditEvent {
  const record: AuditEvent = {
    ...event,
    id: randomUUID(),
    at: new Date().toISOString(),
    ...(event.detail ? { detail: redactText(event.detail) } : {}),
  };
  events.push(record);
  if (events.length > config.auditLogMax) {
    events.splice(0, events.length - config.auditLogMax);
  }
  return record;
}

export function getAuditLogs(limit = 200): AuditEvent[] {
  return events.slice(-limit).reverse();
}

export function clearAuditLogs(): void {
  events.length = 0;
}

export function auditLogCount(): number {
  return events.length;
}

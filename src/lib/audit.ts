import { randomUUID } from 'node:crypto';
import { config } from '../config/index.js';
import { prisma } from './prisma.js';
import { redactText } from './secrets.js';

export type AuditAction =
  | 'auth.register'
  | 'auth.login'
  | 'auth.logout'
  | 'auth.refresh'
  | 'auth.oauth'
  | 'auth.profile.update'
  | 'admin.user.update'
  | 'admin.secrets.read'
  | 'admin.permissions.grant_all'
  | 'plugins.reload'
  | 'integration.connect'
  | 'integration.disconnect'
  | 'integration.reconnect'
  | 'integration.revoke'
  | 'integration.permissions.update'
  | 'integration.primary.change'
  | 'integration.auto_reconnect'
  | 'system.action.approve'
  | 'system.action.reject'
  | 'automation.task.create'
  | 'automation.task.cancel'
  | 'automation.task.retry'
  | 'automation.task.complete'
  | 'automation.task.failed'
  | 'sales.service.create'
  | 'sales.service.update'
  | 'sales.service.delete'
  | 'sales.opportunity.create'
  | 'sales.opportunity.update'
  | 'sales.opportunity.delete'
  | 'sales.opportunity.score'
  | 'sales.opportunity.save'
  | 'sales.lead.create'
  | 'sales.lead.update'
  | 'sales.lead.delete'
  | 'sales.research.create'
  | 'sales.research.delete'
  | 'sales.draft.create'
  | 'sales.draft.update'
  | 'sales.draft.approve'
  | 'sales.draft.send'
  | 'sales.draft.send_failed'
  | 'sales.draft.delete'
  | 'sales.offer.create'
  | 'sales.offer.update'
  | 'sales.offer.delete'
  | 'leads.search'
  | 'leads.lead.saved'
  | 'leads.lead.enriched'
  | 'leads.lead.scored'
  | 'leads.lead.outreach_generated';

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

function persistAuditEvent(event: AuditEvent): void {
  if (!prisma || typeof prisma.auditLog?.create !== 'function') {
    return;
  }
  void prisma.auditLog
    .create({
      data: {
        actorId: event.actorId ?? null,
        actorEmail: event.actorEmail ?? null,
        action: event.action,
        target: event.target ?? null,
        detail: event.detail ?? null,
        ip: event.ip ?? null,
        userAgent: event.userAgent ?? null,
      },
    })
    .catch(() => undefined);
}

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
  persistAuditEvent(record);
  return record;
}

export async function readAuditLogs(limit = 200): Promise<AuditEvent[]> {
  if (!prisma || typeof prisma.auditLog?.findMany !== 'function') {
    return getAuditLogs(limit);
  }
  const rows = await prisma.auditLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  return rows.map((row) => ({
    id: row.id,
    at: row.createdAt.toISOString(),
    ...(row.actorId ? { actorId: row.actorId } : {}),
    ...(row.actorEmail ? { actorEmail: row.actorEmail } : {}),
    action: row.action as AuditAction,
    ...(row.target ? { target: row.target } : {}),
    ...(row.detail ? { detail: row.detail } : {}),
    ...(row.ip ? { ip: row.ip } : {}),
    ...(row.userAgent ? { userAgent: row.userAgent } : {}),
  }));
}

export function getAuditLogs(limit = 200): AuditEvent[] {
  const clamped = Math.min(Math.max(Math.floor(limit), 1), events.length || 1);
  return events.slice(-clamped).reverse();
}

export function clearAuditLogs(): void {
  events.length = 0;
}

export function auditLogCount(): number {
  return events.length;
}

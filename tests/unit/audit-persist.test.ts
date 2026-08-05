import { beforeEach, describe, expect, it, vi } from 'vitest';

process.env.AUDIT_LOG_MAX = '50';
process.env.JWT_SECRET = 'audit-persist-secret';

const state = vi.hoisted(() => {
  type Row = {
    id: string;
    actorId: string | null;
    actorEmail: string | null;
    action: string;
    target: string | null;
    detail: string | null;
    ip: string | null;
    userAgent: string | null;
    createdAt: Date;
  };

  const rows: Row[] = [];

  const auditLog = {
    async create(args: { data: Row }): Promise<Row> {
      const row: Row = {
        id: `aud-${rows.length + 1}`,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        ...args.data,
      };
      rows.push(row);
      return row;
    },
    async findMany(args: { orderBy?: { createdAt?: string }; take?: number }): Promise<Row[]> {
      const list = [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return args.take !== undefined ? list.slice(0, args.take) : list;
    },
  };

  const prisma: Record<string, unknown> = { auditLog };

  return {
    prisma,
    rows,
    clear(): void {
      rows.length = 0;
    },
    dropAuditLog(): void {
      delete prisma.auditLog;
    },
    restoreAuditLog(): void {
      prisma.auditLog = auditLog;
    },
  };
});

vi.mock('../../src/lib/prisma.js', () => ({ prisma: state.prisma, Prisma: {} }));

import * as audit from '../../src/lib/audit.js';

describe('audit persistence', () => {
  beforeEach(() => {
    state.restoreAuditLog();
    state.clear();
    audit.clearAuditLogs();
  });

  it('persists events to the audit log table', () => {
    audit.recordAudit({
      action: 'auth.login',
      actorId: 'user-1',
      actorEmail: 'a@b.c',
      ip: '1.2.3.4',
    });
    audit.recordAudit({ action: 'plugins.reload', actorEmail: 'admin@x.y' });

    expect(state.rows).toHaveLength(2);
    expect(state.rows[0].action).toBe('auth.login');
    expect(state.rows[0].actorId).toBe('user-1');
    expect(state.rows[0].actorEmail).toBe('a@b.c');
    expect(state.rows[1].action).toBe('plugins.reload');
    expect(audit.getAuditLogs()).toHaveLength(2);
  });

  it('reads persisted events through readAuditLogs', async () => {
    audit.recordAudit({
      action: 'admin.user.update',
      actorEmail: 'admin@x.y',
      detail: '{"role":"ADMIN"}',
    });

    const events = await audit.readAuditLogs();
    expect(events).toHaveLength(1);
    expect(events[0].action).toBe('admin.user.update');
    expect(events[0].actorEmail).toBe('admin@x.y');
    expect(events[0].at).toBe('2026-01-01T00:00:00.000Z');
    expect(events[0].detail).toBe('{"role":"ADMIN"}');
  });

  it('respects the requested limit when reading from the table', async () => {
    audit.recordAudit({ action: 'auth.login', actorEmail: 'a@b.c' });
    audit.recordAudit({ action: 'auth.login', actorEmail: 'a@b.c' });
    audit.recordAudit({ action: 'auth.login', actorEmail: 'a@b.c' });

    const events = await audit.readAuditLogs(2);
    expect(events).toHaveLength(2);
  });

  it('falls back to the in-memory ring when the table is unavailable', async () => {
    state.dropAuditLog();

    audit.recordAudit({ action: 'auth.logout' });
    const events = await audit.readAuditLogs();
    expect(state.rows).toHaveLength(0);
    expect(events).toHaveLength(1);
    expect(events[0].action).toBe('auth.logout');
  });
});

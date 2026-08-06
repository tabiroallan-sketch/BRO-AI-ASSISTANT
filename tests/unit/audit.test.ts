import { describe, expect, it, beforeAll, beforeEach } from 'vitest';
import { registerSecret } from '../../src/lib/secrets.js';

process.env.AUDIT_LOG_MAX = '50';
process.env.JWT_SECRET = 'audit-test-secret';

type AuditModule = typeof import('../../src/lib/audit.js');

describe('audit log', () => {
  let audit: AuditModule;

  beforeAll(async () => {
    registerSecret('hunter2-secret-value', 'hunter2-secret-value');
    audit = await import('../../src/lib/audit.js');
  });

  beforeEach(() => {
    audit.clearAuditLogs();
  });

  it('records events with id and timestamp', () => {
    const event = audit.recordAudit({ action: 'auth.login', actorId: 'u1' });
    expect(event.id).toBeDefined();
    expect(event.at).toBeDefined();
    expect(event.action).toBe('auth.login');
  });

  it('returns events newest first', () => {
    audit.recordAudit({ action: 'auth.register', actorId: 'u1' });
    audit.recordAudit({ action: 'auth.login', actorId: 'u1' });
    const logs = audit.getAuditLogs();
    expect(logs.map((log) => log.action)).toEqual(['auth.login', 'auth.register']);
  });

  it('respects a requested limit', () => {
    for (let index = 0; index < 5; index += 1) {
      audit.recordAudit({ action: 'auth.login', actorId: 'u1' });
    }
    expect(audit.getAuditLogs(2)).toHaveLength(2);
  });

  it('caps the log at AUDIT_LOG_MAX entries', () => {
    for (let index = 0; index < 75; index += 1) {
      audit.recordAudit({ action: 'auth.login', actorId: 'u1' });
    }
    expect(audit.auditLogCount()).toBe(50);
  });

  it('redacts secrets from event details', () => {
    audit.recordAudit({ action: 'auth.login', detail: 'hunter2-secret-value leaked' });
    const logs = audit.getAuditLogs();
    expect(logs[0]?.detail).not.toContain('hunter2-secret-value');
  });

  it('tracks the event count', () => {
    expect(audit.auditLogCount()).toBe(0);
    audit.recordAudit({ action: 'auth.logout' });
    expect(audit.auditLogCount()).toBe(1);
  });

  it('records integration security events', () => {
    audit.recordAudit({ action: 'integration.connect', actorId: 'u1', target: 'github' });
    audit.recordAudit({
      action: 'integration.revoke',
      actorId: 'u1',
      target: 'i1',
      detail: 'refresh_token_reuse',
    });
    audit.recordAudit({ action: 'integration.auto_reconnect', actorId: 'u1', target: 'slack' });
    const logs = audit.getAuditLogs();
    expect(logs.map((log) => log.action)).toEqual([
      'integration.auto_reconnect',
      'integration.revoke',
      'integration.connect',
    ]);
  });
});

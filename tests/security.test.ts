import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

type MockUser = {
  id: string;
  email: string;
  role: 'USER' | 'ADMIN';
  isActive: boolean;
  displayName: string | null;
  avatarUrl: string | null;
  googleId: string | null;
};

const { mockPrisma, registerAndLogin, listUsers } = vi.hoisted(() => {
  process.env.DATABASE_URL = '';
  process.env.REDIS_URL = '';
  process.env.JWT_SECRET = 'test-access-secret';
  process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
  process.env.JWT_EXPIRES_IN = '15m';
  process.env.JWT_REFRESH_EXPIRES_IN = '7d';
  process.env.ENCRYPTION_KEY = 'unit-test-encryption-key';

  const users = new Map<string, MockUser>();

  const userModel = {
    async findUnique(args: { where: { id: string } }): Promise<MockUser | null> {
      return users.get(args.where.id) ?? null;
    },
    async findMany(): Promise<MockUser[]> {
      return [...users.values()];
    },
    async update(args: { where: { id: string }; data: Partial<MockUser> }): Promise<MockUser> {
      const existing = users.get(args.where.id);
      if (!existing) {
        throw new Error('User not found');
      }
      const updated = { ...existing, ...args.data };
      users.set(updated.id, updated);
      return updated;
    },
  };

  async function registerAndLogin(
    email: string,
    role: 'USER' | 'ADMIN' = 'USER',
  ): Promise<{ token: string; user: MockUser }> {
    const user: MockUser = {
      id: randomUUID(),
      email,
      role,
      isActive: true,
      displayName: null,
      avatarUrl: null,
      googleId: null,
    };
    users.set(user.id, user);
    const { signAccessToken } = await import('../src/lib/jwt.js');
    return { token: await signAccessToken(user.id, user.role), user };
  }

  return {
    mockPrisma: { user: userModel, $disconnect: async (): Promise<void> => undefined },
    registerAndLogin,
    listUsers: (): MockUser[] => [...users.values()],
  };
});

vi.mock('../src/lib/prisma.js', () => ({ prisma: mockPrisma }));

describe('secrets management', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'bro-secrets-test-'));
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('prefers the <NAME>_FILE secret over the plain environment variable', async () => {
    const { getSecret } = await import('../src/lib/secrets.js');
    const file = path.join(tempDir, 'api-key.txt');
    await writeFile(file, '  from-file-value  ', 'utf8');
    process.env.TEST_API_KEY = 'from-env-value';
    process.env.TEST_API_KEY_FILE = file;

    expect(getSecret('TEST_API_KEY')).toBe('from-file-value');
  });

  it('requireSecret throws when a secret is missing', async () => {
    const { requireSecret } = await import('../src/lib/secrets.js');
    expect(() => requireSecret('NO_SUCH_SECRET_XYZ')).toThrow(/not configured/);
  });

  it('redacts registered secrets of sufficient length from text', async () => {
    const { registerSecret, redactText } = await import('../src/lib/secrets.js');
    registerSecret('REDACT_A', 'abcdef123456789');
    registerSecret('REDACT_B', 'tiny');

    expect(redactText('token is abcdef123456789 here')).toBe('token is [REDACTED] here');
    expect(redactText('tiny stays visible')).toBe('tiny stays visible');
  });

  it('redacts secrets recursively through JSON structures', async () => {
    const { redactJson } = await import('../src/lib/secrets.js');
    expect(
      redactJson({
        secret: 'abcdef123456789',
        nested: { value: 'abcdef123456789', keep: 42 },
        list: ['abcdef123456789', 'x'],
      }),
    ).toEqual({
      secret: '[REDACTED]',
      nested: { value: '[REDACTED]', keep: 42 },
      list: ['[REDACTED]', 'x'],
    });
  });
});

describe('encryption', () => {
  it('encrypts and decrypts values using aes-256-gcm', async () => {
    const { encryptValue, decryptValue, isEncryptionEnabled } =
      await import('../src/lib/encryption.js');

    expect(isEncryptionEnabled()).toBe(true);

    const secret = 'plain-secret-value';
    const encrypted = encryptValue(secret);
    expect(encrypted.startsWith('enc:v1:')).toBe(true);
    expect(encrypted).not.toContain(secret);
    expect(decryptValue(encrypted)).toBe(secret);
  });

  it('passes through non-encrypted and empty values unchanged', async () => {
    const { encryptValue, decryptValue } = await import('../src/lib/encryption.js');

    expect(decryptValue('not-encrypted')).toBe('not-encrypted');
    expect(encryptValue('')).toBe('');
  });
});

describe('output validation', () => {
  it('sanitizes assistant output by stripping control characters', async () => {
    const { sanitizeOutputText } = await import('../src/lib/output-validate.js');
    expect(sanitizeOutputText('line1\x00line2\x07\x1b')).toBe('line1line2');
  });

  it('truncates assistant output to the maximum length', async () => {
    const { sanitizeOutputText, MAX_ASSISTANT_OUTPUT } =
      await import('../src/lib/output-validate.js');
    const long = 'x'.repeat(MAX_ASSISTANT_OUTPUT + 500);
    expect(sanitizeOutputText(long).length).toBe(MAX_ASSISTANT_OUTPUT);
  });

  it('marks truncated tool output', async () => {
    const { validateToolOutput, MAX_TOOL_OUTPUT } = await import('../src/lib/output-validate.js');
    const long = 'y'.repeat(MAX_TOOL_OUTPUT + 500);
    const result = validateToolOutput(long);
    expect(result).toContain('[truncated]');
    expect(result.length).toBe(MAX_TOOL_OUTPUT + '… [truncated]'.length);
  });
});

describe('rate limiting', () => {
  it('throws RateLimitExceededError and sets headers via createRateLimiter', async () => {
    const { createRateLimiter, RateLimitExceededError } = await import('../src/lib/rate-limit.js');
    const headers: string[] = [];
    const request = { ip: '203.0.113.7' } as FastifyRequest;
    const reply = {
      header: (key: string, value: string) => headers.push(`${key}: ${value}`),
    } as unknown as FastifyReply;

    const limiter = createRateLimiter(2, 60000);
    await limiter(request, reply);
    await limiter(request, reply);
    await expect(limiter(request, reply)).rejects.toBeInstanceOf(RateLimitExceededError);

    expect(headers).toContain('RateLimit-Limit: 2');
    expect(headers).toContain('RateLimit-Remaining: 0');
  });
});

describe('audit log', () => {
  it('records and returns events newest-first', async () => {
    const { recordAudit, getAuditLogs, clearAuditLogs } = await import('../src/lib/audit.js');

    clearAuditLogs();
    recordAudit({ action: 'auth.login', actorEmail: 'first@example.com' });
    recordAudit({ action: 'auth.logout', actorEmail: 'second@example.com' });

    const logs = getAuditLogs();
    expect(logs).toHaveLength(2);
    expect(logs[0]?.action).toBe('auth.logout');
    expect(logs[0]?.actorEmail).toBe('second@example.com');
  });

  it('redacts secrets from audit detail', async () => {
    const { registerSecret } = await import('../src/lib/secrets.js');
    const { recordAudit, getAuditLogs, clearAuditLogs } = await import('../src/lib/audit.js');

    registerSecret('AUDIT_TOKEN', 'audit-secret-value-xyz');
    clearAuditLogs();
    recordAudit({ action: 'admin.user.update', detail: 'token=audit-secret-value-xyz' });

    const log = getAuditLogs(1)[0];
    expect(log?.detail).not.toContain('audit-secret-value-xyz');
    expect(log?.detail).toContain('[REDACTED]');
  });
});

describe('security endpoints', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { buildApp } = await import('../src/app.js');
    app = buildApp();
    await app.ready();
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  it('applies security headers to responses', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.headers['x-frame-options']).toBe('DENY');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['cross-origin-resource-policy']).toBe('same-site');
  });

  it('rejects URLs longer than the configured limit', async () => {
    const { config } = await import('../src/config/index.js');
    const longUrl = `/health?${'a'.repeat(config.maxRequestUrlLength + 100)}`;

    const response = await app.inject({ method: 'GET', url: longUrl });
    expect(response.statusCode).toBe(414);
  });

  it('rejects plugins reload for non-admin users', async () => {
    const { token } = await registerAndLogin('user@example.com');
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/plugins/reload',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(403);
  });

  it('allows plugins reload for admin users', async () => {
    const { token } = await registerAndLogin('admin@example.com', 'ADMIN');
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/plugins/reload',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).reloaded).toBe(true);
  });

  it('lists users for admins and rejects regular users', async () => {
    const { token: userToken } = await registerAndLogin('user-list@example.com');
    const forbidden = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/users',
      headers: { authorization: `Bearer ${userToken}` },
    });
    expect(forbidden.statusCode).toBe(403);

    const { token: adminToken } = await registerAndLogin('admin-list@example.com', 'ADMIN');
    const allowed = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/users',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(allowed.statusCode).toBe(200);
    expect(JSON.parse(allowed.body).count).toBeGreaterThan(0);
  });

  it('updates a user role as an admin and blocks self-deactivation', async () => {
    const { token: adminToken, user: admin } = await registerAndLogin(
      'admin-update@example.com',
      'ADMIN',
    );

    const selfBlock = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/users/${admin.id}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { isActive: false },
    });
    expect(selfBlock.statusCode).toBe(400);

    const target = listUsers().find((user) => user.email === 'user-list@example.com');
    const update = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/users/${target?.id}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { role: 'ADMIN' },
    });
    expect(update.statusCode).toBe(200);
    expect(JSON.parse(update.body).user.role).toBe('ADMIN');
  });

  it('exposes the audit log to admins including reload and user-update events', async () => {
    const { token } = await registerAndLogin('admin-audit@example.com', 'ADMIN');
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/audit',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.body);
    expect(body.count).toBeGreaterThan(0);
    expect(body.events.some((event: { action: string }) => event.action === 'plugins.reload')).toBe(
      true,
    );
    expect(
      body.events.some((event: { action: string }) => event.action === 'admin.user.update'),
    ).toBe(true);
  });

  it('returns 429 once the rate limit is exceeded', async () => {
    const { config } = await import('../src/config/index.js');
    const previous = config.rateLimitMax;
    (config as { rateLimitMax: number }).rateLimitMax = 3;
    try {
      let lastStatus = 200;
      for (let index = 0; index < 4; index += 1) {
        const response = await app.inject({ method: 'GET', url: '/api/v1/auth/providers' });
        lastStatus = response.statusCode;
        if (index === 0) {
          expect(response.headers['ratelimit-limit']).toBe('3');
          expect(response.headers['ratelimit-remaining']).toBe('2');
        }
        if (index === 3) {
          expect(response.headers['retry-after']).toBeDefined();
        }
      }
      expect(lastStatus).toBe(429);
    } finally {
      (config as { rateLimitMax: number }).rateLimitMax = previous;
    }
  });
});

import { access, mkdtemp, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

process.env.DATABASE_URL = '';
process.env.REDIS_URL = '';
process.env.JWT_SECRET = 'test-access-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
process.env.JWT_EXPIRES_IN = '15m';
process.env.JWT_REFRESH_EXPIRES_IN = '7d';

type MockUser = {
  id: string;
  email: string;
  passwordHash: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  role: 'USER' | 'ADMIN';
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

type MockSession = {
  id: string;
  userId: string;
  token: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

type Session = {
  headers: { authorization: string };
  userId: string;
};

const { mockPrisma, resetDb, registerAndLogin } = vi.hoisted(() => {
  const users = new Map<string, MockUser>();
  const sessions = new Map<string, MockSession>();

  const userModel = {
    async findUnique(args: { where: { id?: string; email?: string } }): Promise<MockUser | null> {
      if (args.where.id !== undefined) {
        return users.get(args.where.id) ?? null;
      }
      if (args.where.email !== undefined) {
        for (const user of users.values()) {
          if (user.email === args.where.email) {
            return user;
          }
        }
      }
      return null;
    },
    async create(args: {
      data: { email: string; passwordHash: string | null; displayName?: string | null };
    }): Promise<MockUser> {
      const now = new Date();
      const user: MockUser = {
        id: randomUUID(),
        email: args.data.email,
        passwordHash: args.data.passwordHash,
        displayName: args.data.displayName ?? null,
        avatarUrl: null,
        role: 'USER',
        isActive: true,
        createdAt: now,
        updatedAt: now,
      };
      users.set(user.id, user);
      return user;
    },
  };

  const sessionModel = {
    async create(args: {
      data: { userId: string; token: string; expiresAt: Date };
    }): Promise<MockSession> {
      const now = new Date();
      const session: MockSession = {
        id: randomUUID(),
        userId: args.data.userId,
        token: args.data.token,
        expiresAt: args.data.expiresAt,
        createdAt: now,
        updatedAt: now,
      };
      sessions.set(session.id, session);
      return session;
    },
    async findFirst(args: {
      where: { token: string };
      include?: { user: { select?: unknown } };
    }): Promise<(MockSession & { user: MockUser }) | null> {
      for (const session of sessions.values()) {
        if (session.token === args.where.token) {
          const user = users.get(session.userId);
          if (user) {
            return { ...session, user };
          }
        }
      }
      return null;
    },
    async delete(args: { where: { id: string } }): Promise<MockSession> {
      const session = sessions.get(args.where.id);
      if (session) {
        sessions.delete(args.where.id);
      }
      return session ?? ({} as MockSession);
    },
  };

  async function registerAndLogin(email: string): Promise<Session> {
    const now = new Date();
    const user: MockUser = {
      id: randomUUID(),
      email,
      passwordHash: 'hash',
      displayName: null,
      avatarUrl: null,
      role: 'USER',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };
    users.set(user.id, user);
    const session: MockSession = {
      id: randomUUID(),
      userId: user.id,
      token: `token-${user.id}`,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      createdAt: now,
      updatedAt: now,
    };
    sessions.set(session.id, session);

    const { signAccessToken } = await import('../src/lib/jwt.js');
    const token = await signAccessToken(user.id, user.role);
    return { headers: { authorization: `Bearer ${token}` }, userId: user.id };
  }

  return {
    mockPrisma: {
      user: userModel,
      session: sessionModel,
      $disconnect: async (): Promise<void> => undefined,
    },
    resetDb: (): void => {
      users.clear();
      sessions.clear();
    },
    registerAndLogin,
  };
});

vi.mock('../src/lib/prisma.js', () => ({ prisma: mockPrisma }));

let tempRoot: string | undefined;

async function makeTempRoot(): Promise<string> {
  tempRoot = await mkdtemp(join(tmpdir(), 'bro-system-routes-'));
  return tempRoot;
}

describe('system actions', () => {
  let app: FastifyInstance;
  let confirmations: typeof import('../src/system/confirmation-store.js');

  beforeAll(async () => {
    confirmations = await import('../src/system/confirmation-store.js');
    const { buildApp } = await import('../src/app.js');
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  beforeEach(() => {
    resetDb();
    confirmations.clearConfirmations();
  });

  afterEach(() => {
    confirmations.clearConfirmations();
  });

  async function authSession(email: string): Promise<Session> {
    return registerAndLogin(email);
  }

  function pendingFor(
    userId: string,
    overrides: Partial<{ toolName: string; args: Record<string, unknown>; summary: string }> = {},
  ) {
    return confirmations.createPendingAction({
      userId,
      toolName: overrides.toolName ?? 'system_create_folder',
      args: overrides.args ?? { path: join(tmpdir(), 'bro-never-created') },
      summary: overrides.summary ?? 'Create a folder',
    });
  }

  it('requires authentication to list actions', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/system/actions' });
    expect(response.statusCode).toBe(401);
  });

  it('requires authentication to decide an action', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/system/actions/some-id/decision',
      payload: { decision: 'approve' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('lists pending actions for the current user with system tools', async () => {
    const owner = await authSession('owner@example.com');
    const other = await authSession('other@example.com');

    const mine = pendingFor(owner.userId, {
      toolName: 'system_run_command',
      args: { command: 'echo hi' },
    });
    const theirs = pendingFor(other.userId);
    void theirs;

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/system/actions',
      headers: owner.headers,
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.actions).toHaveLength(1);
    expect(body.actions[0].id).toBe(mine.id);
    expect(body.actions[0].toolName).toBe('system_run_command');
    expect(body.actions[0].status).toBe('pending');

    const names = body.tools.map((tool: { name: string }) => tool.name);
    expect(names).toContain('system_create_folder');
    expect(names).toContain('system_launch_app');
    expect(names).toContain('system_read_clipboard');
    const createTool = body.tools.find(
      (tool: { name: string }) => tool.name === 'system_create_folder',
    );
    expect(createTool.requireConfirmation).toBe(true);
    const readClipboard = body.tools.find(
      (tool: { name: string }) => tool.name === 'system_read_clipboard',
    );
    expect(readClipboard.requireConfirmation).toBe(false);
  });

  it('honours the limit query parameter', async () => {
    const session = await authSession('limited@example.com');

    pendingFor(session.userId, {
      toolName: 'system_run_command',
      args: { command: 'echo one' },
    });
    pendingFor(session.userId, {
      toolName: 'system_run_command',
      args: { command: 'echo two' },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/system/actions?limit=1',
      headers: session.headers,
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.actions).toHaveLength(1);
    expect(body.actions[0].args.command).toBe('echo two');
  });

  it('approves an action and executes the tool', async () => {
    const session = await authSession('approve@example.com');
    const root = await makeTempRoot();
    const target = join(root, 'sub', 'nested');
    const action = pendingFor(session.userId, {
      toolName: 'system_create_folder',
      args: { path: target },
      summary: `Create folder ${target}`,
    });

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/system/actions/${action.id}/decision`,
      headers: session.headers,
      payload: { decision: 'approve' },
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.action.status).toBe('approved');
    expect(body.action.result).toContain('Created');
    await expect(access(target)).resolves.toBeUndefined();
  });

  it('rejects an action without executing the tool', async () => {
    const session = await authSession('reject@example.com');
    const root = await makeTempRoot();
    const target = join(root, 'should-not-exist');
    const action = pendingFor(session.userId, {
      toolName: 'system_create_folder',
      args: { path: target },
      summary: `Create folder ${target}`,
    });

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/system/actions/${action.id}/decision`,
      headers: session.headers,
      payload: { decision: 'reject' },
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.action.status).toBe('rejected');
    await expect(access(target)).rejects.toThrow();
  });

  it('returns an error result when tool execution fails', async () => {
    const session = await authSession('fail@example.com');
    const action = pendingFor(session.userId, {
      toolName: 'system_create_folder',
      args: { path: 'not-a-real-root:\0nul' },
    });

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/system/actions/${action.id}/decision`,
      headers: session.headers,
      payload: { decision: 'approve' },
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.action.status).toBe('approved');
    expect(body.action.result).toContain('Error:');
  });

  it('returns 404 for an unknown action id', async () => {
    const session = await authSession('missing@example.com');
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/system/actions/does-not-exist/decision',
      headers: session.headers,
      payload: { decision: 'approve' },
    });
    expect(response.statusCode).toBe(404);
  });

  it("returns 403 when deciding another user's action", async () => {
    const owner = await authSession('owner@example.com');
    const intruder = await authSession('intruder@example.com');

    const action = pendingFor(owner.userId);

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/system/actions/${action.id}/decision`,
      headers: intruder.headers,
      payload: { decision: 'approve' },
    });
    expect(response.statusCode).toBe(403);
  });

  it('returns 409 when the action is no longer pending', async () => {
    const session = await authSession('twice@example.com');
    const action = pendingFor(session.userId);

    await app.inject({
      method: 'POST',
      url: `/api/v1/system/actions/${action.id}/decision`,
      headers: session.headers,
      payload: { decision: 'reject' },
    });
    const second = await app.inject({
      method: 'POST',
      url: `/api/v1/system/actions/${action.id}/decision`,
      headers: session.headers,
      payload: { decision: 'approve' },
    });
    expect(second.statusCode).toBe(409);
  });

  it('returns 409 for an expired action', async () => {
    const session = await authSession('expired@example.com');
    const action = pendingFor(session.userId);
    action.expiresAt = new Date(Date.now() - 1000).toISOString();

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/system/actions/${action.id}/decision`,
      headers: session.headers,
      payload: { decision: 'approve' },
    });
    expect(response.statusCode).toBe(409);
  });

  it('rejects an invalid decision body with 400', async () => {
    const session = await authSession('invalid@example.com');
    const action = pendingFor(session.userId);

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/system/actions/${action.id}/decision`,
      headers: session.headers,
      payload: { decision: 'maybe' },
    });
    expect(response.statusCode).toBe(400);
  });
});

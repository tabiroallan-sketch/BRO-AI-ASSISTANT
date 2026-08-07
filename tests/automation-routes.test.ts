import { randomUUID } from 'node:crypto';
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

type MockTask = {
  id: string;
  userId: string;
  title: string;
  goal: string;
  status: string;
  options: Record<string, unknown>;
  createdAt: string;
  currentStepIndex: number;
  steps: unknown[];
  logs: unknown[];
  error?: string;
  finishedAt?: string;
};

const { mockAutomationEngine, seedTask, clearTasks } = vi.hoisted(() => {
  const tasks = new Map<string, MockTask>();
  const listeners = new Set<(event: { task: MockTask }) => void>();
  const order = new Map<string, number>();
  let counter = 0;

  function makeTask(input: {
    id?: string;
    userId: string;
    title?: string;
    goal?: string;
    status?: string;
  }): MockTask {
    const now = new Date().toISOString();
    return {
      id: input.id ?? `task-${++counter}`,
      userId: input.userId,
      title: input.title ?? 'Untitled task',
      goal: input.goal ?? 'Do a thing',
      status: input.status ?? 'queued',
      options: { maxRetries: 2, continueOnError: false, notifyOnCompletion: true },
      createdAt: now,
      currentStepIndex: 0,
      steps: [],
      logs: [{ at: now, level: 'info', message: 'queued' }],
    };
  }

  function setTask(task: MockTask): void {
    tasks.set(task.id, task);
    order.set(task.id, order.size);
  }

  return {
    mockAutomationEngine: {
      createTask: vi.fn(
        (input: {
          userId: string;
          title: string;
          goal: string;
          options?: Record<string, unknown>;
        }): MockTask => {
          const task = makeTask({ userId: input.userId, title: input.title, goal: input.goal });
          setTask(task);
          return { ...task };
        },
      ),
      listTasks: vi.fn(
        (userId: string, query: { limit?: number; status?: string } = {}): MockTask[] => {
          const limit = Math.min(Math.max(Math.floor(query.limit ?? 50), 1), 200);
          return [...tasks.values()]
            .filter((task) => task.userId === userId)
            .filter((task) => (query.status ? task.status === query.status : true))
            .sort((a, b) => {
              const cmp = b.createdAt.localeCompare(a.createdAt);
              if (cmp !== 0) {
                return cmp;
              }
              return (order.get(b.id) ?? 0) - (order.get(a.id) ?? 0);
            })
            .slice(0, limit);
        },
      ),
      getTask: vi.fn((id: string): MockTask | undefined => {
        const task = tasks.get(id);
        return task ? { ...task } : undefined;
      }),
      cancel: vi.fn((id: string): boolean => {
        const task = tasks.get(id);
        if (!task || ['completed', 'failed', 'cancelled'].includes(task.status)) {
          return false;
        }
        task.status = 'cancelled';
        return true;
      }),
      retry: vi.fn((id: string): boolean => {
        const task = tasks.get(id);
        if (!task || !['failed', 'cancelled'].includes(task.status)) {
          return false;
        }
        task.status = 'queued';
        return true;
      }),
      continueAfterDecision: vi.fn(),
      onTaskEvent: vi.fn((listener: (event: { task: MockTask }) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      }),
      snapshot: (task: MockTask): MockTask => ({ ...task }),
      clear: vi.fn(),
    },
    seedTask: (input: {
      id?: string;
      userId: string;
      title?: string;
      goal?: string;
      status?: string;
    }): MockTask => {
      const task = makeTask(input);
      setTask(task);
      return { ...task };
    },
    clearTasks: (): void => {
      tasks.clear();
      order.clear();
      listeners.clear();
    },
  };
});

vi.mock('../src/automation/index.js', () => ({ automationEngine: mockAutomationEngine }));

describe('automation tasks', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { buildApp } = await import('../src/app.js');
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    resetDb();
    clearTasks();
  });

  async function authSession(email: string): Promise<Session> {
    return registerAndLogin(email);
  }

  it('requires authentication for every task endpoint', async () => {
    const list = await app.inject({ method: 'GET', url: '/api/v1/automations/tasks' });
    expect(list.statusCode).toBe(401);

    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/automations/tasks',
      payload: { title: 'T', goal: 'g' },
    });
    expect(create.statusCode).toBe(401);

    const single = await app.inject({ method: 'GET', url: '/api/v1/automations/tasks/x' });
    expect(single.statusCode).toBe(401);

    const cancel = await app.inject({ method: 'POST', url: '/api/v1/automations/tasks/x/cancel' });
    expect(cancel.statusCode).toBe(401);

    const retry = await app.inject({ method: 'POST', url: '/api/v1/automations/tasks/x/retry' });
    expect(retry.statusCode).toBe(401);

    const stream = await app.inject({ method: 'GET', url: '/api/v1/automations/tasks/x/stream' });
    expect(stream.statusCode).toBe(401);
  });

  it('creates a task', async () => {
    const session = await authSession('creator@example.com');
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/automations/tasks',
      headers: session.headers,
      payload: { title: 'Prep the report', goal: 'Summarize the week' },
    });
    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body);
    expect(body.task.title).toBe('Prep the report');
    expect(body.task.goal).toBe('Summarize the week');
    expect(body.task.userId).toBe(session.userId);
    expect(body.task.status).toBe('queued');
    expect(mockAutomationEngine.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ userId: session.userId, title: 'Prep the report' }),
    );
  });

  it('rejects an invalid task body with 400', async () => {
    const session = await authSession('invalid@example.com');
    const empty = await app.inject({
      method: 'POST',
      url: '/api/v1/automations/tasks',
      headers: session.headers,
      payload: {},
    });
    expect(empty.statusCode).toBe(400);

    const blankGoal = await app.inject({
      method: 'POST',
      url: '/api/v1/automations/tasks',
      headers: session.headers,
      payload: { title: 'T', goal: '   ' },
    });
    expect(blankGoal.statusCode).toBe(400);

    const badOption = await app.inject({
      method: 'POST',
      url: '/api/v1/automations/tasks',
      headers: session.headers,
      payload: { title: 'T', goal: 'g', options: { maxRetries: -1 } },
    });
    expect(badOption.statusCode).toBe(400);
  });

  it('lists tasks for the current user, honouring limit and status', async () => {
    const owner = await authSession('owner@example.com');
    const other = await authSession('other@example.com');

    seedTask({ userId: owner.userId, title: 'first', status: 'completed' });
    seedTask({ userId: owner.userId, title: 'second' });
    const theirs = seedTask({ userId: other.userId, title: 'theirs' });

    const all = await app.inject({
      method: 'GET',
      url: '/api/v1/automations/tasks',
      headers: owner.headers,
    });
    expect(all.statusCode).toBe(200);
    let body = JSON.parse(all.body);
    expect(body.tasks).toHaveLength(2);
    expect(body.tasks.every((task: MockTask) => task.userId === owner.userId)).toBe(true);
    expect(body.tasks.map((task: MockTask) => task.id)).not.toContain(theirs.id);

    const limited = await app.inject({
      method: 'GET',
      url: '/api/v1/automations/tasks?limit=1',
      headers: owner.headers,
    });
    body = JSON.parse(limited.body);
    expect(body.tasks).toHaveLength(1);
    expect(body.tasks[0].title).toBe('second');

    const completed = await app.inject({
      method: 'GET',
      url: '/api/v1/automations/tasks?status=completed',
      headers: owner.headers,
    });
    body = JSON.parse(completed.body);
    expect(body.tasks).toHaveLength(1);
    expect(body.tasks[0].title).toBe('first');
  });

  it('returns a single task', async () => {
    const session = await authSession('single@example.com');
    const task = seedTask({ userId: session.userId, title: 'mine' });

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/automations/tasks/${task.id}`,
      headers: session.headers,
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.task.id).toBe(task.id);
    expect(body.task.title).toBe('mine');
  });

  it('returns 404 for unknown or foreign tasks', async () => {
    const owner = await authSession('owner2@example.com');
    const intruder = await authSession('intruder2@example.com');
    const task = seedTask({ userId: owner.userId });

    const missing = await app.inject({
      method: 'GET',
      url: '/api/v1/automations/tasks/nope',
      headers: owner.headers,
    });
    expect(missing.statusCode).toBe(404);

    const foreign = await app.inject({
      method: 'GET',
      url: `/api/v1/automations/tasks/${task.id}`,
      headers: intruder.headers,
    });
    expect(foreign.statusCode).toBe(404);

    const foreignCancel = await app.inject({
      method: 'POST',
      url: `/api/v1/automations/tasks/${task.id}/cancel`,
      headers: intruder.headers,
    });
    expect(foreignCancel.statusCode).toBe(404);

    const foreignRetry = await app.inject({
      method: 'POST',
      url: `/api/v1/automations/tasks/${task.id}/retry`,
      headers: intruder.headers,
    });
    expect(foreignRetry.statusCode).toBe(404);

    const foreignStream = await app.inject({
      method: 'GET',
      url: `/api/v1/automations/tasks/${task.id}/stream`,
      headers: intruder.headers,
    });
    expect(foreignStream.statusCode).toBe(404);
  });

  it('cancels a cancellable task', async () => {
    const session = await authSession('cancel@example.com');
    const task = seedTask({ userId: session.userId, status: 'running' });

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/automations/tasks/${task.id}/cancel`,
      headers: session.headers,
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.task.status).toBe('cancelled');

    const again = await app.inject({
      method: 'POST',
      url: `/api/v1/automations/tasks/${task.id}/cancel`,
      headers: session.headers,
    });
    expect(again.statusCode).toBe(409);
  });

  it('retries a failed task', async () => {
    const session = await authSession('retry@example.com');
    const task = seedTask({ userId: session.userId, status: 'failed' });

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/automations/tasks/${task.id}/retry`,
      headers: session.headers,
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.task.status).toBe('queued');

    const running = await app.inject({
      method: 'POST',
      url: `/api/v1/automations/tasks/${task.id}/retry`,
      headers: session.headers,
    });
    expect(running.statusCode).toBe(409);
  });

  it('restricts the n8n overview to admins', async () => {
    const session = await authSession('plain@example.com');
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/automations',
      headers: session.headers,
    });
    expect(response.statusCode).toBe(403);
  });
});

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
  cancelAutomationTask,
  createAutomationTask,
  getAutomationTask,
  isTerminalTaskStatus,
  listAutomationTasks,
  retryAutomationTask,
  streamAutomationTask,
  type AutomationStreamEvent,
  type AutomationTask,
} from '@/lib/automation';
import { setTokens } from '@/lib/token-store';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function task(overrides: Partial<AutomationTask> = {}): AutomationTask {
  return {
    id: 'task-1',
    userId: 'user-1',
    title: 'Prep the report',
    goal: 'Summarize the week',
    status: 'queued',
    options: { maxRetries: 2, continueOnError: false, notifyOnCompletion: true },
    createdAt: '2026-08-07T00:00:00.000Z',
    currentStepIndex: 0,
    steps: [],
    logs: [{ at: '2026-08-07T00:00:00.000Z', level: 'info', message: 'queued' }],
    ...overrides,
  };
}

function sseResponse(...events: AutomationStreamEvent[]): Response {
  const body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('');
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

describe('automation client', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    setTokens('access-token', 'refresh-token');
  });

  it('creates a task with the bearer token', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ task: task() }));

    const created = await createAutomationTask({
      title: 'Prep the report',
      goal: 'Summarize the week',
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://test.local/api/v1/automations/tasks');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ authorization: 'Bearer access-token' });
    expect(JSON.parse(init.body as string)).toEqual({
      title: 'Prep the report',
      goal: 'Summarize the week',
    });
    expect(created.id).toBe('task-1');
  });

  it('passes options through on create', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ task: task() }));

    await createAutomationTask({
      title: 'T',
      goal: 'G',
      options: { maxRetries: 4, continueOnError: true, notifyOnCompletion: false },
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      title: 'T',
      goal: 'G',
      options: { maxRetries: 4, continueOnError: true, notifyOnCompletion: false },
    });
  });

  it('lists tasks with limit and status query params', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ tasks: [task()] }));

    const tasks = await listAutomationTasks({ limit: 25, status: 'running' });

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://test.local/api/v1/automations/tasks?limit=25&status=running');
    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe('task-1');
  });

  it('lists tasks without query params by default', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ tasks: [] }));

    await listAutomationTasks();

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://test.local/api/v1/automations/tasks');
  });

  it('gets a single task', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ task: task({ status: 'completed' }) }));

    const result = await getAutomationTask('task-1');

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://test.local/api/v1/automations/tasks/task-1');
    expect(result.status).toBe('completed');
  });

  it('cancels a task', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ task: task({ status: 'cancelled' }) }));

    const result = await cancelAutomationTask('task-1');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://test.local/api/v1/automations/tasks/task-1/cancel');
    expect(init.method).toBe('POST');
    expect(result.status).toBe('cancelled');
  });

  it('retries a task', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ task: task({ status: 'queued' }) }));

    const result = await retryAutomationTask('task-1');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://test.local/api/v1/automations/tasks/task-1/retry');
    expect(init.method).toBe('POST');
    expect(result.status).toBe('queued');
  });

  it('streams task events to the callback', async () => {
    fetchMock.mockResolvedValue(
      sseResponse(
        { type: 'snapshot', task: task() },
        { type: 'update', task: task({ status: 'running' }) },
        { type: 'update', task: task({ status: 'completed' }) },
      ),
    );

    const received: AutomationStreamEvent[] = [];
    await streamAutomationTask('task-1', (event) => received.push(event));

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://test.local/api/v1/automations/tasks/task-1/stream');
    expect(init.headers).toMatchObject({ authorization: 'Bearer access-token' });
    expect(received.map((event) => event.type)).toEqual(['snapshot', 'update', 'update']);
    expect(received[2]).toMatchObject({ type: 'update' });
    if (received[2].type === 'update') {
      expect(received[2].task.status).toBe('completed');
    }
  });

  it('throws an ApiError with the server message on stream failure', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: { message: 'Task not found' } }, 404));

    await expect(streamAutomationTask('nope', () => undefined)).rejects.toMatchObject({
      status: 404,
      message: 'Task not found',
    });
  });
});

describe('isTerminalTaskStatus', () => {
  it('identifies terminal statuses', () => {
    expect(isTerminalTaskStatus('completed')).toBe(true);
    expect(isTerminalTaskStatus('failed')).toBe(true);
    expect(isTerminalTaskStatus('cancelled')).toBe(true);
  });

  it('identifies active statuses', () => {
    expect(isTerminalTaskStatus('queued')).toBe(false);
    expect(isTerminalTaskStatus('planning')).toBe(false);
    expect(isTerminalTaskStatus('running')).toBe(false);
    expect(isTerminalTaskStatus('awaiting_confirmation')).toBe(false);
  });
});

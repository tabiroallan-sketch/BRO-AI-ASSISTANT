import { requirePermission } from '../integrations/access.js';
import { fetchWithTimeout } from '../lib/http.js';
import type { Tool } from './types.js';

type FetchInit = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
};

type TaskList = { id?: string; title?: string };
type TaskItem = {
  id?: string;
  title?: string;
  status?: string;
  due?: string | null;
  notes?: string;
};

async function tasksRequest(token: string, path: string, init: FetchInit = {}): Promise<Response> {
  return fetchWithTimeout(`https://tasks.googleapis.com/tasks/v1${path}`, {
    ...init,
    timeoutMs: 10_000,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
}

export const tasksListTool: Tool = {
  name: 'tasks_list',
  providerId: 'google-tasks',
  description:
    'List the user\u2019s Google Tasks lists, or the tasks inside a given list with their due dates.',
  parameters: {
    type: 'object',
    properties: {
      listId: {
        type: 'string',
        description: 'Optional task list ID. When omitted, the task lists themselves are returned.',
      },
    },
  },
  async execute(args, context) {
    const token = await requirePermission(context.userId, 'google-tasks', 'tasks.read');
    const listId = typeof args.listId === 'string' ? args.listId.trim() : '';

    if (!listId) {
      const response = await tasksRequest(token, '/users/@me/lists');
      if (!response.ok) {
        throw new Error(`Google Tasks request failed with status ${response.status}`);
      }
      const body = (await response.json()) as { items?: TaskList[] };
      const lists = body.items ?? [];
      if (lists.length === 0) {
        return 'No task lists found.';
      }
      const lines = lists.map(
        (list, index) =>
          `${index + 1}. ${list.title ?? '(untitled)'} (id: ${list.id ?? 'unknown'})`,
      );
      return lines.join('\n');
    }

    const response = await tasksRequest(
      token,
      `/lists/${encodeURIComponent(listId)}/tasks?showCompleted=false`,
    );
    if (!response.ok) {
      throw new Error(`Google Tasks request failed with status ${response.status}`);
    }
    const body = (await response.json()) as { items?: TaskItem[] };
    const tasks = body.items ?? [];
    if (tasks.length === 0) {
      return 'No tasks in this list.';
    }
    const lines = tasks.map((task, index) => {
      const due = task.due ? ` (due ${task.due.slice(0, 10)})` : '';
      return `${index + 1}. ${task.title ?? '(untitled)'}${due}`;
    });
    return lines.join('\n');
  },
};

export const tasksCreateTool: Tool = {
  name: 'tasks_create',
  providerId: 'google-tasks',
  description: 'Create a new task in the user\u2019s Google Tasks.',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Task title.' },
      listId: {
        type: 'string',
        description: 'Optional task list ID. Defaults to the primary "Tasks" list.',
      },
      notes: { type: 'string', description: 'Optional task notes.' },
      due: {
        type: 'string',
        description: 'Optional RFC 3339 due date, e.g. "2026-08-10T00:00:00.000Z".',
      },
    },
    required: ['title'],
  },
  async execute(args, context) {
    const title = typeof args.title === 'string' ? args.title.trim() : '';
    if (!title) {
      throw new Error('Missing "title" argument');
    }
    const listId =
      typeof args.listId === 'string' && args.listId.trim() ? args.listId.trim() : '@default';
    const notes = typeof args.notes === 'string' ? args.notes.trim() : '';
    const due = typeof args.due === 'string' ? args.due.trim() : '';
    const token = await requirePermission(context.userId, 'google-tasks', 'tasks.write');

    const payload: Record<string, string> = { title };
    if (notes) {
      payload.notes = notes;
    }
    if (due) {
      payload.due = due;
    }
    const response = await tasksRequest(token, `/lists/${encodeURIComponent(listId)}/tasks`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error(`Google Tasks request failed with status ${response.status}`);
    }
    const created = (await response.json()) as TaskItem;
    return `Task created (id: ${created.id ?? 'unknown'}): ${title}`;
  },
};

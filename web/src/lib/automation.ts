import { API_BASE_URL, ApiError, refresh as refreshTokens, request } from '@/lib/api';
import { getAccessToken, setTokens } from '@/lib/token-store';

export type AutomationTaskStatus =
  | 'queued'
  | 'planning'
  | 'running'
  | 'awaiting_confirmation'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type AutomationStepStatus =
  'queued' | 'running' | 'completed' | 'failed' | 'rejected' | 'awaiting_confirmation';

export type AutomationStep = {
  id: string;
  order: number;
  toolName: string;
  args: Record<string, unknown>;
  description: string;
  status: AutomationStepStatus;
  result?: string;
  error?: string;
  attempts: number;
};

export type AutomationTaskLog = {
  at: string;
  level: 'info' | 'warn' | 'error';
  message: string;
};

export type AutomationTaskOptions = {
  maxRetries?: number;
  continueOnError?: boolean;
  notifyOnCompletion?: boolean;
};

export type AutomationTask = {
  id: string;
  userId: string;
  title: string;
  goal: string;
  status: AutomationTaskStatus;
  options: Required<AutomationTaskOptions>;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  currentStepIndex: number;
  steps: AutomationStep[];
  logs: AutomationTaskLog[];
};

export type AutomationStreamEvent =
  | { type: 'snapshot'; task: AutomationTask }
  | { type: 'update'; task: AutomationTask }
  | { type: 'ping' };

export type CreateAutomationTaskInput = {
  title: string;
  goal: string;
  options?: AutomationTaskOptions;
};

export type ListAutomationTasksQuery = {
  limit?: number;
  status?: AutomationTaskStatus;
};

export const TERMINAL_TASK_STATUSES: AutomationTaskStatus[] = ['completed', 'failed', 'cancelled'];

export function isTerminalTaskStatus(status: AutomationTaskStatus): boolean {
  return TERMINAL_TASK_STATUSES.includes(status);
}

function authToken(): string {
  const token = getAccessToken();
  if (!token) {
    throw new ApiError(401, 'Not authenticated');
  }
  return token;
}

export async function createAutomationTask(
  input: CreateAutomationTaskInput,
): Promise<AutomationTask> {
  const result = await request<{ task: AutomationTask }>('/automations/tasks', {
    method: 'POST',
    token: authToken(),
    body: {
      title: input.title,
      goal: input.goal,
      ...(input.options ? { options: input.options } : {}),
    },
  });
  return result.task;
}

export async function listAutomationTasks(
  query: ListAutomationTasksQuery = {},
): Promise<AutomationTask[]> {
  const params = new URLSearchParams();
  if (query.limit !== undefined) {
    params.set('limit', String(query.limit));
  }
  if (query.status !== undefined) {
    params.set('status', query.status);
  }
  const search = params.toString();
  const result = await request<{ tasks: AutomationTask[] }>(
    `/automations/tasks${search ? `?${search}` : ''}`,
    { token: authToken() },
  );
  return result.tasks;
}

export async function getAutomationTask(id: string): Promise<AutomationTask> {
  const result = await request<{ task: AutomationTask }>(`/automations/tasks/${id}`, {
    token: authToken(),
  });
  return result.task;
}

export async function cancelAutomationTask(id: string): Promise<AutomationTask> {
  const result = await request<{ task: AutomationTask }>(`/automations/tasks/${id}/cancel`, {
    method: 'POST',
    token: authToken(),
  });
  return result.task;
}

export async function retryAutomationTask(id: string): Promise<AutomationTask> {
  const result = await request<{ task: AutomationTask }>(`/automations/tasks/${id}/retry`, {
    method: 'POST',
    token: authToken(),
  });
  return result.task;
}

async function* parseSseEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<AutomationStreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  function drain(): AutomationStreamEvent[] {
    const events: AutomationStreamEvent[] = [];
    const blocks = buffer.split('\n\n');
    buffer = blocks.pop() ?? '';
    for (const block of blocks) {
      for (const line of block.split('\n')) {
        if (!line.startsWith('data: ')) {
          continue;
        }
        try {
          events.push(JSON.parse(line.slice('data: '.length)) as AutomationStreamEvent);
        } catch {
          // Ignore malformed events; the stream continues.
        }
      }
    }
    return events;
  }

  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    for (const event of drain()) {
      yield event;
    }
  }

  buffer += decoder.decode();
  for (const block of buffer.split('\n\n')) {
    for (const line of block.split('\n')) {
      if (!line.startsWith('data: ')) {
        continue;
      }
      try {
        yield JSON.parse(line.slice('data: '.length)) as AutomationStreamEvent;
      } catch {
        // Ignore malformed trailing events.
      }
    }
  }
}

async function openTaskStream(id: string, signal?: AbortSignal): Promise<Response> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${getAccessToken() ?? ''}`,
  };
  const response = await fetch(`${API_BASE_URL}/automations/tasks/${id}/stream`, {
    headers,
    signal,
  });

  if (response.status === 401) {
    try {
      const refreshed = await refreshTokens();
      setTokens(refreshed.accessToken, refreshed.refreshToken);
      headers.authorization = `Bearer ${refreshed.accessToken}`;
      return await fetch(`${API_BASE_URL}/automations/tasks/${id}/stream`, {
        headers,
        signal,
      });
    } catch {
      return response;
    }
  }

  return response;
}

export async function streamAutomationTask(
  id: string,
  onEvent: (event: AutomationStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await openTaskStream(id, signal);

  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    throw new ApiError(
      response.status,
      data?.error?.message ?? `Request failed (${response.status})`,
    );
  }

  if (!response.body) {
    throw new ApiError(502, 'Response stream unavailable');
  }

  for await (const event of parseSseEvents(response.body)) {
    onEvent(event);
  }
}

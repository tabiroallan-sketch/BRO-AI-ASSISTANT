import { config } from '../config/index.js';

export function isN8nConfigured(): boolean {
  return Boolean(config.n8nBaseUrl && config.n8nApiKey);
}

export function n8nNotConfiguredMessage(): string {
  return 'n8n is not configured. Set N8N_BASE_URL and N8N_API_KEY (create an API key in n8n under Settings > API) to enable the n8n tools.';
}

type N8nRequestInit = {
  method?: string;
  body?: string;
  headers?: Record<string, string>;
};

const DEFAULT_TIMEOUT_MS = 15_000;

async function n8nFetch(
  path: string,
  init: N8nRequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<unknown> {
  if (!isN8nConfigured()) {
    throw new Error(n8nNotConfiguredMessage());
  }
  const base = config.n8nBaseUrl.replace(/\/+$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${base}/api/v1/${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        'X-N8N-API-KEY': config.n8nApiKey,
        ...(init.headers ?? {}),
      },
    });
    if (!response.ok) {
      let detail = '';
      try {
        const body = (await response.json()) as { message?: string };
        detail = body.message ?? '';
      } catch {
        // ignore non-JSON error bodies
      }
      throw new Error(`n8n request failed (HTTP ${response.status})${detail ? `: ${detail}` : ''}`);
    }
    const text = await response.text();
    return text ? (JSON.parse(text) as unknown) : {};
  } finally {
    clearTimeout(timer);
  }
}

function unwrapData(body: unknown): unknown {
  const wrapped = body as { data?: unknown } | null;
  return wrapped?.data ?? body;
}

export type N8nWorkflow = Record<string, unknown>;
export type N8nExecution = Record<string, unknown>;

export function isTerminalN8nStatus(status: string): boolean {
  return ['success', 'error', 'crashed', 'canceled', 'cancelled'].includes(status);
}

export function n8nExecutionStatus(execution: N8nExecution): string {
  const status = typeof execution.status === 'string' ? execution.status : '';
  if (status) {
    return status;
  }
  return execution.finished === true ? 'finished' : 'running';
}

export async function listN8nWorkflows(limit: number, activeOnly: boolean): Promise<N8nWorkflow[]> {
  const params = new URLSearchParams({ limit: String(Math.min(Math.max(limit, 1), 100)) });
  if (activeOnly) {
    params.set('active', 'true');
  }
  const body = await n8nFetch(`workflows?${params.toString()}`);
  const data = unwrapData(body);
  return Array.isArray(data) ? (data as N8nWorkflow[]) : [];
}

export async function getN8nWorkflow(id: string): Promise<N8nWorkflow> {
  const body = await n8nFetch(`workflows/${encodeURIComponent(id)}`);
  const data = unwrapData(body);
  return (data as N8nWorkflow) ?? {};
}

export async function executeN8nWorkflow(id: string, variables: unknown): Promise<N8nExecution> {
  const body = await n8nFetch(
    `workflows/${encodeURIComponent(id)}/execute`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ data: variables ?? {} }),
    },
    120_000,
  );
  const data = unwrapData(body);
  return (data as N8nExecution) ?? {};
}

export async function listN8nExecutions(options: {
  limit?: number;
  status?: string;
}): Promise<{ count: number; executions: N8nExecution[] }> {
  const params = new URLSearchParams({
    limit: String(Math.min(Math.max(options.limit ?? 20, 1), 100)),
  });
  if (options.status) {
    params.set('status', options.status);
  }
  const body = await n8nFetch(`executions?${params.toString()}`);
  const data = unwrapData(body) as { count?: number; executions?: N8nExecution[] } | null;
  if (Array.isArray(data)) {
    return { count: data.length, executions: data as N8nExecution[] };
  }
  const executions = data?.executions ?? [];
  return { count: data?.count ?? executions.length, executions };
}

export async function getN8nExecution(id: string, includeData: boolean): Promise<N8nExecution> {
  const body = await n8nFetch(`executions/${encodeURIComponent(id)}?includeData=${includeData}`);
  const data = unwrapData(body);
  return (data as N8nExecution) ?? {};
}

export async function stopN8nExecution(id: string): Promise<void> {
  await n8nFetch(`executions/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function waitForN8nExecution(
  id: string,
  options: { timeoutMs: number; pollMs: number },
): Promise<N8nExecution> {
  const deadline = Date.now() + Math.max(options.timeoutMs, 1000);
  const pollMs = Math.max(options.pollMs, 50);
  let last: N8nExecution = {};
  while (Date.now() < deadline) {
    last = await getN8nExecution(id, false);
    if (isTerminalN8nStatus(n8nExecutionStatus(last))) {
      return getN8nExecution(id, true);
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  return { ...last, timedOut: true };
}

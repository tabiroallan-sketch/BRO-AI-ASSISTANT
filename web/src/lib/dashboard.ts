import { request } from '@/lib/api';
import { getAccessToken } from '@/lib/token-store';

export type ToolInfo = {
  name: string;
  description: string;
};

export type WorkflowSummary = {
  id: string;
  name: string;
  active: boolean;
};

export type ExecutionSummary = {
  id: string;
  workflowId: string;
  workflowName: string;
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
};

export type AutomationsResponse = {
  enabled: boolean;
  configured: boolean;
  workflows: WorkflowSummary[];
  executions: ExecutionSummary[];
  error?: string;
};

export type AnalyticsResponse = {
  totals: {
    conversations: number;
    memories: number;
    integrations: number;
    notifications: number;
    messages: number;
  };
  messagesByRole: { user: number; assistant: number };
  daily: Array<{ date: string; count: number }>;
};

export type LogEntry = {
  level: string;
  time: string;
  msg: string;
  req?: Record<string, unknown> | null;
  res?: Record<string, unknown> | null;
};

export type PluginInfo = {
  name: string;
  version: string;
  description?: string;
  author?: string;
  enabled: boolean;
  state: 'loaded' | 'error';
  error?: string;
  tools: string[];
  loadedAt: string;
};

function authToken(): string {
  const token = getAccessToken();
  if (!token) {
    throw new Error('Not authenticated');
  }
  return token;
}

export async function listTools(): Promise<ToolInfo[]> {
  const result = await request<{ tools: ToolInfo[] }>('/tools', { token: authToken() });
  return result.tools;
}

export async function getAutomations(): Promise<AutomationsResponse> {
  return request<AutomationsResponse>('/automations', { token: authToken() });
}

export async function getAnalytics(): Promise<AnalyticsResponse> {
  return request<AnalyticsResponse>('/analytics', { token: authToken() });
}

export async function getLogs(limit = 200): Promise<LogEntry[]> {
  const result = await request<{ logs: LogEntry[] }>(`/logs?limit=${limit}`, {
    token: authToken(),
  });
  return result.logs;
}

export async function clearLogs(): Promise<void> {
  await request<void>('/logs', { method: 'DELETE', token: authToken() });
}

export async function listPlugins(): Promise<PluginInfo[]> {
  const result = await request<{ plugins: PluginInfo[] }>('/plugins', { token: authToken() });
  return result.plugins;
}

export async function reloadPlugins(): Promise<{ loaded: string[]; failed: number }> {
  const result = await request<{
    loaded: Array<{ name: string }>;
    skipped: string[];
    failed: Array<{ file: string; error: string }>;
  }>('/plugins/reload', { method: 'POST', token: authToken() });
  return { loaded: result.loaded.map((plugin) => plugin.name), failed: result.failed.length };
}

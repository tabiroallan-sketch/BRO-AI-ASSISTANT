import { request } from './api';

export type LLMProviderInfo = {
  id: string;
  label: string;
  description: string;
  requiresApiKey: boolean;
  envVar: string;
  configured: boolean;
  defaultModel: string | null;
  defaultBaseUrl: string | null;
};

export type LLMModelInfo = {
  id: string;
  name?: string;
  contextWindow?: number;
  capabilities?: string[];
  description?: string;
};

export type LLMConnectionResult = {
  ok: boolean;
  status: string;
  message: string;
  latencyMs?: number;
  model?: string;
};

export type LLMSettings = {
  providerId: string | null;
  model: string | null;
  hasApiKey: boolean;
  activeProvider: LLMProviderInfo | null;
  status: string | null;
  message: string | null;
  latencyMs: number | null;
  lastTestedAt: string | null;
};

export function listLLMProviders(): Promise<{ providers: LLMProviderInfo[] }> {
  return request<{ providers: LLMProviderInfo[] }>('/llm/providers');
}

export function listLLMModels(
  providerId: string,
): Promise<{ models: LLMModelInfo[]; defaultModel: string | null }> {
  return request<{ models: LLMModelInfo[]; defaultModel: string | null }>(
    `/llm/providers/${encodeURIComponent(providerId)}/models`,
  );
}

export function setLLMModel(providerId: string, model: string): Promise<{ model: string }> {
  return request<{ model: string }>(`/llm/providers/${encodeURIComponent(providerId)}/model`, {
    method: 'POST',
    body: { model },
  });
}

export function testLLMProvider(
  providerId: string,
  settings: { apiKey?: string; model?: string; baseUrl?: string },
): Promise<LLMConnectionResult> {
  return request<LLMConnectionResult>(`/llm/providers/${encodeURIComponent(providerId)}/test`, {
    method: 'POST',
    body: settings,
  });
}

export function getLLMSettings(): Promise<LLMSettings> {
  return request<LLMSettings>('/llm/settings');
}

export function saveLLMSettings(input: {
  providerId?: string;
  model?: string;
  apiKey?: string;
}): Promise<LLMSettings> {
  return request<LLMSettings>('/llm/settings', {
    method: 'PUT',
    body: input,
  });
}

export function clearLLMApiKey(): Promise<LLMSettings> {
  return request<LLMSettings>('/llm/settings/api-key', {
    method: 'DELETE',
  });
}

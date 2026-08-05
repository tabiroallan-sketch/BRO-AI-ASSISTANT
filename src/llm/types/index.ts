export type LLMMessageRole = 'system' | 'user' | 'assistant' | 'tool';

export type LLMToolCall = {
  id: string;
  name: string;
  arguments: string;
  extraContent?: Record<string, unknown>;
};

export type LLMMessage = {
  role: LLMMessageRole;
  content: string | null;
  tool_calls?: LLMToolCall[];
  tool_call_id?: string;
};

export type LLMToolParameterSchema = {
  type: 'object';
  properties: Record<string, { type: string; description?: string }>;
  required?: string[];
  additionalProperties?: boolean;
};

export type LLMTool = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: LLMToolParameterSchema;
  };
};

export type LLMChatRequest = {
  messages: LLMMessage[];
  tools?: LLMTool[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  stop?: string[];
};

export type LLMStreamOptions = {
  signal?: AbortSignal;
};

export type LLMRequestOptions = {
  signal?: AbortSignal;
};

export type LLMUsage = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
};

export type LLMStreamEvent =
  | { type: 'content'; content: string }
  | { type: 'tool_calls'; toolCalls: LLMToolCall[] }
  | { type: 'usage'; usage: LLMUsage };

export type LLMCompletion = {
  content: string;
  toolCalls: LLMToolCall[];
  usage?: LLMUsage;
  model?: string;
};

export type LLMModelInfo = {
  id: string;
  name?: string;
  contextWindow?: number;
  capabilities?: string[];
  description?: string;
};

export type ProviderStatus =
  'connected' | 'connecting' | 'disconnected' | 'auth_failed' | 'rate_limited' | 'unavailable';

export type ProviderConnectionResult = {
  ok: boolean;
  status: ProviderStatus;
  message: string;
  latencyMs?: number;
  model?: string;
};

export type ProviderSettings = {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  extra?: Record<string, unknown>;
};

export type ProviderDescriptor = {
  id: string;
  label: string;
  description: string;
  logoUrl?: string;
  defaultModel?: string;
  requiresApiKey: boolean;
  envVar: string;
  defaultBaseUrl?: string;
};

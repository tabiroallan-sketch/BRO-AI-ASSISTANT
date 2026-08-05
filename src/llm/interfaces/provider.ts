import type {
  LLMCompletion,
  LLMChatRequest,
  LLMModelInfo,
  LLMRequestOptions,
  LLMStreamEvent,
  LLMStreamOptions,
  LLMUsage,
  ProviderConnectionResult,
  ProviderDescriptor,
  ProviderSettings,
} from '../types/index.js';

/**
 * The single interface the rest of BRO talks to. Every provider (NVIDIA, OpenAI,
 * Gemini, Ollama, OpenRouter, ...) implements this contract so application logic
 * never depends on a specific provider SDK.
 */
export interface LLMProvider {
  readonly descriptor: ProviderDescriptor;

  /** True when a usable API key (and any other required config) is available. */
  isConfigured(settings?: ProviderSettings): boolean;

  /** Load provider configuration. Safe to call multiple times. */
  initialize(settings?: ProviderSettings): Promise<void>;

  /** Verify the API key / connectivity against the provider. */
  testConnection(settings?: ProviderSettings): Promise<ProviderConnectionResult>;

  /** Fetch the models this provider exposes. */
  listModels(): Promise<LLMModelInfo[]>;

  /** Stream a chat completion as events (content / tool_calls / usage). */
  streamChat(request: LLMChatRequest, options?: LLMStreamOptions): AsyncGenerator<LLMStreamEvent>;

  /** Get a single (non-streaming) chat completion. */
  completeChat(request: LLMChatRequest, options?: LLMRequestOptions): Promise<LLMCompletion>;

  /** Usage accumulated by the most recent request, if the provider reports it. */
  getUsage(): LLMUsage | null;

  /** Abort any in-flight request. */
  cancel(): void;

  /** Release resources (cancels in-flight work and drops cached clients). */
  dispose(): void;
}

import OpenAI from 'openai';
import type {
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
  ChatCompletionMessageFunctionToolCall,
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
  ChatCompletionTool,
} from 'openai/resources/chat/completions';
import { createHooks, type ProviderHooks } from '../hooks/index.js';
import type { LLMProvider } from '../interfaces/provider.js';
import type {
  LLMCompletion,
  LLMChatRequest,
  LLMMessage,
  LLMModelInfo,
  LLMRequestOptions,
  LLMStreamEvent,
  LLMStreamOptions,
  LLMToolCall,
  LLMUsage,
  ProviderConnectionResult,
  ProviderDescriptor,
  ProviderSettings,
  ProviderStatus,
} from '../types/index.js';
import { LLMError, cancelledError, classifyHttpError, isRetryableError } from '../utils/errors.js';
import { retryWithBackoff } from '../utils/retry.js';

export type BaseProviderOptions = {
  hooks?: ProviderHooks;
  maxRetries?: number;
  retryInitialDelayMs?: number;
};

type OpenAIUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
};

type ChunkDelta = {
  content?: string | null;
  tool_calls?: Array<{
    index?: number;
    id?: string;
    function?: { name?: string; arguments?: string };
  }>;
};

/**
 * Shared engine for providers that expose an OpenAI-compatible chat completions
 * API (NVIDIA, OpenAI, Gemini, Ollama, OpenRouter, ...). Subclasses only supply
 * a descriptor, environment settings and a model catalog.
 */
export abstract class BaseProvider implements LLMProvider {
  abstract readonly descriptor: ProviderDescriptor;

  protected settings: ProviderSettings = {};
  protected lastUsage: LLMUsage | null = null;
  protected readonly hooks: ProviderHooks;
  protected readonly maxRetries: number;
  protected readonly retryInitialDelayMs: number;

  private client: OpenAI | null = null;
  private clientKey = '';
  private activeController: AbortController | null = null;

  constructor(options: BaseProviderOptions = {}) {
    this.hooks = createHooks(options.hooks);
    this.maxRetries = options.maxRetries ?? 3;
    this.retryInitialDelayMs = options.retryInitialDelayMs ?? 1000;
  }

  isConfigured(settings?: ProviderSettings): boolean {
    const apiKey = settings?.apiKey ?? this.settings.apiKey;
    return this.descriptor.requiresApiKey ? Boolean(apiKey?.trim()) : true;
  }

  async initialize(settings: ProviderSettings = {}): Promise<void> {
    this.settings = settings;
    this.client = null;
    this.clientKey = '';
    this.lastUsage = null;
  }

  async testConnection(settings?: ProviderSettings): Promise<ProviderConnectionResult> {
    const startedAt = Date.now();
    const candidate = settings ?? this.settings;
    if (!this.isConfigured(candidate)) {
      return {
        ok: false,
        status: 'disconnected',
        message: `${this.descriptor.label} is not configured (missing API key).`,
      };
    }
    const previousSettings = this.settings;
    this.settings = candidate;
    this.client = null;
    this.clientKey = '';
    try {
      const completion = await this.completeChat({
        messages: [{ role: 'user', content: 'Say OK.' }],
        maxTokens: 8,
      });
      return {
        ok: true,
        status: 'connected',
        message: 'Connection successful.',
        latencyMs: Date.now() - startedAt,
        model: completion.model ?? candidate.model,
      };
    } catch (error) {
      const llmError = this.toLLMError(error);
      return {
        ok: false,
        status: statusFromError(llmError),
        message: llmError.message,
        latencyMs: Date.now() - startedAt,
      };
    } finally {
      this.settings = previousSettings;
      this.client = null;
      this.clientKey = '';
    }
  }

  abstract listModels(): Promise<LLMModelInfo[]>;

  async *streamChat(
    request: LLMChatRequest,
    options: LLMStreamOptions = {},
  ): AsyncGenerator<LLMStreamEvent> {
    const controller = new AbortController();
    this.activeController = controller;
    const signal = controller.signal;
    const forwardAbort = (): void => controller.abort();
    options.signal?.addEventListener('abort', forwardAbort, { once: true });

    const startedAt = Date.now();
    this.hooks.onEvent?.({ type: 'beforeRequest', providerId: this.descriptor.id, startedAt });

    try {
      const client = this.getClient();
      const params: ChatCompletionCreateParamsStreaming = {
        model: this.resolveModel(request.model),
        messages: this.toWireMessages(request.messages),
        stream: true,
        ...(request.tools && request.tools.length > 0
          ? { tools: request.tools as unknown as ChatCompletionTool[] }
          : {}),
        ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
        ...(request.maxTokens !== undefined ? { max_tokens: request.maxTokens } : {}),
        ...(request.stop && request.stop.length > 0 ? { stop: request.stop } : {}),
      };

      const stream = await retryWithBackoff(
        () => client.chat.completions.create(params, { signal }),
        {
          maxRetries: this.maxRetries,
          initialDelayMs: this.retryInitialDelayMs,
          signal,
          isRetryable: (error) => isRetryableError(this.toLLMError(error)),
        },
      );

      const toolCallAccumulators = new Map<
        number,
        { id: string; name: string; arguments: string }
      >();
      for await (const chunk of stream) {
        if (signal.aborted) {
          throw cancelledError(this.descriptor.id);
        }
        const choice = chunk.choices?.[0];
        const delta: ChunkDelta | undefined = choice?.delta;
        if (delta?.content) {
          yield { type: 'content', content: delta.content };
        }
        for (const call of delta?.tool_calls ?? []) {
          const index = call.index ?? 0;
          const accumulator = toolCallAccumulators.get(index) ?? {
            id: '',
            name: '',
            arguments: '',
          };
          if (call.id) {
            accumulator.id = call.id;
          }
          if (call.function?.name) {
            accumulator.name += call.function.name;
          }
          if (call.function?.arguments) {
            accumulator.arguments += call.function.arguments;
          }
          toolCallAccumulators.set(index, accumulator);
        }
        if (chunk.usage) {
          this.lastUsage = this.normalizeUsage(chunk.usage);
          yield { type: 'usage', usage: this.lastUsage };
        }
      }

      if (toolCallAccumulators.size > 0) {
        const toolCalls: LLMToolCall[] = [...toolCallAccumulators.entries()].map(
          ([index, call]) => ({
            id: call.id || `call_${index}`,
            name: call.name,
            arguments: call.arguments,
          }),
        );
        yield { type: 'tool_calls', toolCalls };
      }

      this.hooks.onEvent?.({
        type: 'afterRequest',
        providerId: this.descriptor.id,
        durationMs: Date.now() - startedAt,
      });
      if (this.lastUsage) {
        this.hooks.onEvent?.({
          type: 'usage',
          providerId: this.descriptor.id,
          usage: this.lastUsage,
        });
      }
    } catch (error) {
      if (signal.aborted || isAbortError(error)) {
        const cancelled = cancelledError(this.descriptor.id);
        this.hooks.onEvent?.({ type: 'error', providerId: this.descriptor.id, error: cancelled });
        throw cancelled;
      }
      const llmError = this.toLLMError(error);
      this.hooks.onEvent?.({ type: 'error', providerId: this.descriptor.id, error: llmError });
      throw llmError;
    } finally {
      options.signal?.removeEventListener('abort', forwardAbort);
      if (this.activeController === controller) {
        this.activeController = null;
      }
    }
  }

  async completeChat(
    request: LLMChatRequest,
    options: LLMRequestOptions = {},
  ): Promise<LLMCompletion> {
    const startedAt = Date.now();
    this.hooks.onEvent?.({ type: 'beforeRequest', providerId: this.descriptor.id, startedAt });

    try {
      const client = this.getClient();
      const params: ChatCompletionCreateParamsNonStreaming = {
        model: this.resolveModel(request.model),
        messages: this.toWireMessages(request.messages),
        ...(request.tools && request.tools.length > 0
          ? { tools: request.tools as unknown as ChatCompletionTool[] }
          : {}),
        ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
        ...(request.maxTokens !== undefined ? { max_tokens: request.maxTokens } : {}),
        ...(request.stop && request.stop.length > 0 ? { stop: request.stop } : {}),
      };

      const response = await retryWithBackoff(
        () =>
          client.chat.completions.create(params, options.signal ? { signal: options.signal } : {}),
        {
          maxRetries: this.maxRetries,
          initialDelayMs: this.retryInitialDelayMs,
          signal: options.signal,
          isRetryable: (error) => isRetryableError(this.toLLMError(error)),
        },
      );

      const choice = response.choices[0];
      const message = choice?.message;
      const toolCalls = (message?.tool_calls ?? []).filter(
        (call): call is ChatCompletionMessageFunctionToolCall => 'function' in call,
      );

      if (response.usage) {
        this.lastUsage = this.normalizeUsage(response.usage);
        this.hooks.onEvent?.({
          type: 'usage',
          providerId: this.descriptor.id,
          usage: this.lastUsage,
        });
      }
      this.hooks.onEvent?.({
        type: 'afterRequest',
        providerId: this.descriptor.id,
        durationMs: Date.now() - startedAt,
      });

      return {
        content: message?.content ?? '',
        toolCalls: toolCalls.map((call) => ({
          id: call.id,
          name: call.function.name,
          arguments: call.function.arguments,
          ...(callHasExtraContent(call) ? { extraContent: call.extra_content } : {}),
        })),
        ...(response.usage ? { usage: this.lastUsage ?? undefined } : {}),
        ...(response.model ? { model: response.model } : {}),
      };
    } catch (error) {
      if (isAbortError(error)) {
        const cancelled = cancelledError(this.descriptor.id);
        this.hooks.onEvent?.({ type: 'error', providerId: this.descriptor.id, error: cancelled });
        throw cancelled;
      }
      const llmError = this.toLLMError(error);
      this.hooks.onEvent?.({ type: 'error', providerId: this.descriptor.id, error: llmError });
      throw llmError;
    }
  }

  getUsage(): LLMUsage | null {
    return this.lastUsage;
  }

  cancel(): void {
    this.activeController?.abort();
  }

  dispose(): void {
    this.activeController?.abort();
    this.activeController = null;
    this.client = null;
    this.clientKey = '';
    this.lastUsage = null;
  }

  protected resolveModel(model?: string): string {
    const resolved = model ?? this.settings.model ?? this.descriptor.defaultModel;
    if (!resolved) {
      throw new LLMError({
        code: 'not_configured',
        providerId: this.descriptor.id,
        message: `No model selected for ${this.descriptor.label}.`,
      });
    }
    return resolved;
  }

  protected getClient(): OpenAI {
    const apiKey = this.settings.apiKey;
    if (this.descriptor.requiresApiKey && !apiKey?.trim()) {
      throw new LLMError({
        code: 'not_configured',
        providerId: this.descriptor.id,
        message: `${this.descriptor.label} is not configured. Set ${this.descriptor.envVar} or configure an API key in settings.`,
      });
    }
    const baseUrl = this.settings.baseUrl ?? this.descriptor.defaultBaseUrl;
    const key = `${apiKey ?? ''}::${baseUrl ?? ''}`;
    if (this.client && this.clientKey === key) {
      return this.client;
    }
    const created = this.createClient(apiKey ?? '', baseUrl ?? '');
    this.client = created;
    this.clientKey = key;
    return created;
  }

  /** Overridable so tests and specialized providers can inject a client. */
  protected createClient(apiKey: string, baseUrl: string): OpenAI {
    return new OpenAI({
      apiKey,
      ...(baseUrl ? { baseURL: baseUrl } : {}),
    });
  }

  protected toWireMessages(messages: LLMMessage[]): ChatCompletionMessageParam[] {
    return messages.map((message): ChatCompletionMessageParam => {
      if (message.role === 'assistant' && message.tool_calls && message.tool_calls.length > 0) {
        return {
          role: 'assistant',
          content: message.content,
          tool_calls: message.tool_calls.map(
            (call) =>
              ({
                id: call.id,
                type: 'function',
                function: { name: call.name, arguments: call.arguments },
                ...(call.extraContent ? { extra_content: call.extraContent } : {}),
              }) as ChatCompletionMessageToolCall,
          ),
        };
      }
      if (message.role === 'tool') {
        return {
          role: 'tool',
          tool_call_id: message.tool_call_id ?? '',
          content: message.content ?? '',
        };
      }
      return {
        role: message.role,
        content: message.content ?? '',
      };
    });
  }

  protected normalizeUsage(usage: OpenAIUsage): LLMUsage {
    return {
      promptTokens: usage.prompt_tokens,
      completionTokens: usage.completion_tokens,
      totalTokens: usage.total_tokens,
    };
  }

  protected toLLMError(error: unknown): LLMError {
    if (error instanceof LLMError) {
      return error;
    }
    if (isAbortError(error)) {
      return cancelledError(this.descriptor.id);
    }
    const candidate = error as {
      status?: unknown;
      statusCode?: unknown;
      message?: string;
      name?: string;
    };
    const status = typeof candidate.status === 'number' ? candidate.status : undefined;
    const statusCode = typeof candidate.statusCode === 'number' ? candidate.statusCode : undefined;
    if (status !== undefined || statusCode !== undefined) {
      return classifyHttpError({
        providerId: this.descriptor.id,
        status: status ?? statusCode,
        message: candidate.message,
        cause: error,
      });
    }
    const name = candidate.name ?? '';
    if (name === 'AbortError' || name === 'TimeoutError' || name.includes('Timeout')) {
      return new LLMError({
        code: 'timeout',
        providerId: this.descriptor.id,
        message: candidate.message ?? 'The provider request timed out.',
        cause: error,
        retryable: true,
      });
    }
    if (error instanceof TypeError || name === 'FetchError' || name === 'NetworkError') {
      return new LLMError({
        code: 'network',
        providerId: this.descriptor.id,
        message: 'Network error while contacting the provider.',
        cause: error,
      });
    }
    return new LLMError({
      code: 'unknown',
      providerId: this.descriptor.id,
      message: candidate.message ?? 'Unknown provider error.',
      cause: error,
    });
  }
}

function statusFromError(error: LLMError): ProviderStatus {
  switch (error.code) {
    case 'auth_failed':
      return 'auth_failed';
    case 'rate_limited':
      return 'rate_limited';
    case 'model_unavailable':
    case 'network':
    case 'timeout':
      return 'unavailable';
    default:
      return 'disconnected';
  }
}

function isAbortError(error: unknown): boolean {
  if (error instanceof Error && error.name === 'AbortError') {
    return true;
  }
  return (error as { code?: unknown })?.code === 'ABORT_ERR';
}

function callHasExtraContent(
  call: ChatCompletionMessageFunctionToolCall,
): call is ChatCompletionMessageFunctionToolCall & { extra_content: Record<string, unknown> } {
  return Boolean((call as unknown as { extra_content?: Record<string, unknown> }).extra_content);
}

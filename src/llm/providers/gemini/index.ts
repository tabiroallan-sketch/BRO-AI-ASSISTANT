import { BaseProvider, type BaseProviderOptions } from '../base.js';
import type {
  LLMCompletion,
  LLMChatRequest,
  LLMModelInfo,
  LLMRequestOptions,
  LLMStreamEvent,
  LLMStreamOptions,
  ProviderDescriptor,
} from '../../types/index.js';
import { getSecret } from '../../../lib/secrets.js';
import { LLMError } from '../../utils/errors.js';

/**
 * Curated fallback catalog of chat-capable Gemini models. Used when no API key
 * is available (or the live model fetch fails); once a key is configured the
 * catalog is refreshed from the provider's /models endpoint.
 */
export const GEMINI_MODELS: LLMModelInfo[] = [
  {
    id: 'gemini-3.6-flash',
    name: 'Gemini 3.6 Flash',
    contextWindow: 1048576,
    capabilities: ['chat', 'tools'],
    description: 'Fast, high-throughput multimodal model with strong tool use.',
  },
  {
    id: 'gemini-3.5-flash',
    name: 'Gemini 3.5 Flash',
    contextWindow: 1048576,
    capabilities: ['chat', 'tools'],
    description: 'Fast multimodal model for everyday chat and tool calling.',
  },
  {
    id: 'gemini-3.5-flash-lite',
    name: 'Gemini 3.5 Flash Lite',
    contextWindow: 1048576,
    capabilities: ['chat', 'tools'],
    description: 'Lightweight, low-latency model for high-volume chat.',
  },
  {
    id: 'gemini-3.1-flash-lite',
    name: 'Gemini 3.1 Flash Lite',
    contextWindow: 1048576,
    capabilities: ['chat', 'tools'],
    description: 'Budget-friendly Flash model with a long context window.',
  },
  {
    id: 'gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    contextWindow: 1048576,
    capabilities: ['chat', 'tools'],
    description: 'Cost-efficient Flash model with 1M-token context.',
  },
  {
    id: 'gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    contextWindow: 1048576,
    capabilities: ['chat', 'tools', 'reasoning'],
    description: 'Frontier model for complex reasoning and agentic tasks.',
  },
  {
    id: 'gemini-2.5-flash-lite',
    name: 'Gemini 2.5 Flash Lite',
    contextWindow: 1048576,
    capabilities: ['chat', 'tools'],
    description: 'Minimal-cost Flash Lite model.',
  },
  {
    id: 'gemini-2.0-flash',
    name: 'Gemini 2.0 Flash',
    contextWindow: 1048576,
    capabilities: ['chat', 'tools'],
    description: 'Fast, reliable multimodal model.',
  },
];

export const GEMINI_DEFAULT_MODEL = 'gemini-3.5-flash';

const NON_CHAT_MODEL_MARKERS = [
  'tts',
  'embedding',
  'image',
  'veo',
  'lyria',
  'live',
  'robotics',
  'computer-use',
  'computer_use',
  'antigravity',
  'research',
  'aqa',
  'imagen',
];

type GeminiModelsPayload = {
  data?: Array<{
    id?: string;
    display_name?: string;
    owned_by?: string;
  }>;
};

/**
 * Google Gemini provider served through its OpenAI-compatible endpoint
 * (https://generativelanguage.googleapis.com/v1beta/openai). It reuses the
 * shared BaseProvider engine; the key is stored under OPENAI_API_KEY so a key
 * saved here also powers voice transcription and the AI assistant layer.
 */
export class GeminiProvider extends BaseProvider {
  readonly descriptor: ProviderDescriptor = {
    id: 'gemini',
    label: 'Gemini (OpenAI-compatible)',
    description:
      'Google Gemini served through its OpenAI-compatible endpoint. Paste a Gemini API key to enable chat and voice transcription.',
    requiresApiKey: true,
    envVar: 'OPENAI_API_KEY',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: GEMINI_DEFAULT_MODEL,
  };

  constructor(options: BaseProviderOptions = {}) {
    super(options);
  }

  async listModels(): Promise<LLMModelInfo[]> {
    const apiKey = getSecret(this.descriptor.envVar) ?? this.settings.apiKey ?? '';
    if (!apiKey.trim()) {
      return GEMINI_MODELS;
    }
    try {
      const baseUrl = this.settings.baseUrl ?? this.descriptor.defaultBaseUrl ?? '';
      const response = await fetch(`${baseUrl}/models`, {
        headers: { Authorization: `Bearer ${apiKey.trim()}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        return GEMINI_MODELS;
      }
      const payload = (await response.json()) as GeminiModelsPayload;
      const models = (payload.data ?? [])
        .map((model) => {
          const id = (model.id ?? '').replace(/^models\//, '').trim();
          return { id, name: model.display_name ?? id };
        })
        .filter(
          (model) =>
            model.id &&
            !NON_CHAT_MODEL_MARKERS.some((marker) => model.id.toLowerCase().includes(marker)),
        )
        .map((model): LLMModelInfo => ({
          id: model.id,
          name: model.name,
          capabilities: ['chat'],
        }));
      return models.length > 0 ? models : GEMINI_MODELS;
    } catch {
      return GEMINI_MODELS;
    }
  }

  /**
   * Streams a chat completion, transparently retrying with the next catalog
   * model when the requested model is quota-limited. Gemini applies the free
   * tier quota per model (e.g. 20 requests/day for gemini-3.5-flash), so a
   * model that is exhausted can often be bypassed by using another one.
   */
  override async *streamChat(
    request: LLMChatRequest,
    options: LLMStreamOptions = {},
  ): AsyncGenerator<LLMStreamEvent> {
    let firstQuotaError: LLMError | undefined;
    let lastError: LLMError | undefined;
    for (const [index, model] of this.candidateModels(request.model).entries()) {
      try {
        yield* super.streamChat({ ...request, model }, options);
        return;
      } catch (error) {
        const llmError = this.toLLMError(error);
        if (this.isTerminalError(llmError.code)) {
          throw llmError;
        }
        if (llmError.code === 'rate_limited' && !firstQuotaError) {
          firstQuotaError = llmError;
        }
        lastError = llmError;
        // A non-quota failure on the primary model is the real error; surface
        // it instead of hiding it behind a chain of model fallbacks.
        if (index === 0 && !this.isCycleableError(llmError.code)) {
          throw llmError;
        }
      }
    }
    throw (
      firstQuotaError ??
      lastError ??
      new LLMError({
        code: 'unknown',
        providerId: this.descriptor.id,
        message: 'No Gemini model could generate a response.',
      })
    );
  }

  /** Single (non-streaming) completion with the same quota-aware model cycling. */
  override async completeChat(
    request: LLMChatRequest,
    options: LLMRequestOptions = {},
  ): Promise<LLMCompletion> {
    let firstQuotaError: LLMError | undefined;
    let lastError: LLMError | undefined;
    for (const [index, model] of this.candidateModels(request.model).entries()) {
      try {
        return await super.completeChat({ ...request, model }, options);
      } catch (error) {
        const llmError = this.toLLMError(error);
        if (this.isTerminalError(llmError.code)) {
          throw llmError;
        }
        if (llmError.code === 'rate_limited' && !firstQuotaError) {
          firstQuotaError = llmError;
        }
        lastError = llmError;
        if (index === 0 && !this.isCycleableError(llmError.code)) {
          throw llmError;
        }
      }
    }
    throw (
      firstQuotaError ??
      lastError ??
      new LLMError({
        code: 'unknown',
        providerId: this.descriptor.id,
        message: 'No Gemini model could generate a response.',
      })
    );
  }

  /** Errors that indicate an account-level problem; never masked by cycling. */
  private isTerminalError(code: string): boolean {
    return (
      code === 'cancelled' ||
      code === 'auth_failed' ||
      code === 'network' ||
      code === 'timeout' ||
      code === 'not_configured'
    );
  }

  /** Errors worth skipping to the next model during quota-aware cycling. */
  private isCycleableError(code: string): boolean {
    return code === 'rate_limited' || code === 'model_unavailable' || code === 'invalid_request';
  }

  private candidateModels(requestModel?: string): string[] {
    const resolved = this.resolveModel(requestModel);
    const ordered = [resolved, ...GEMINI_MODELS.map((model) => model.id)];
    return [...new Set(ordered)];
  }
}

import type { LLMProvider } from '../interfaces/provider.js';
import { providerRegistry, type ProviderRegistry } from '../registry/index.js';
import { cancelledError, isCancelled, LLMError } from '../utils/errors.js';
import { config } from '../../config/index.js';

export type FallbackFailure = {
  providerId: string;
  error: LLMError;
};

export type ProviderFallbackOptions = {
  /** Provider ids tried first, in order; remaining registered providers are appended. */
  order?: string[];
  /** When false, only the first provider in the chain is ever used. */
  enabled?: boolean;
};

/**
 * Tries each provider in the chain until one succeeds. The callback is expected
 * to initialize and use the provider. Failures are collected; a cancelled
 * request never falls back. When every provider fails, the sole failure (or an
 * aggregate error) is thrown.
 */
export class ProviderFallback {
  private readonly registry: ProviderRegistry;
  private readonly preferredOrder: string[];
  private readonly enabled: boolean;

  constructor(registry: ProviderRegistry, options: ProviderFallbackOptions = {}) {
    this.registry = registry;
    this.preferredOrder = options.order ?? [];
    this.enabled = options.enabled ?? true;
  }

  async execute<T>(fn: (provider: LLMProvider) => Promise<T>): Promise<T> {
    const order = this.enabled ? this.effectiveOrder() : this.effectiveOrder().slice(0, 1);
    const failures: FallbackFailure[] = [];
    let lastError: LLMError | undefined;

    for (const id of order) {
      const provider = this.registry.get(id);
      if (!provider) {
        continue;
      }
      try {
        return await fn(provider);
      } catch (error) {
        const llmError = toFallbackError(error, provider.descriptor.id);
        if (isCancelled(llmError)) {
          throw llmError;
        }
        failures.push({ providerId: id, error: llmError });
        lastError = llmError;
      }
    }

    const firstFailure = failures[0];
    if (!firstFailure) {
      throw new LLMError({
        code: 'not_configured',
        providerId: 'unknown',
        message: 'No LLM providers are available.',
      });
    }
    if (failures.length === 1) {
      throw firstFailure.error;
    }
    throw new LLMError({
      code: 'unknown',
      providerId: firstFailure.providerId,
      message: `All AI providers failed. ${failures
        .map((failure) => `${failure.providerId}: ${failure.error.message}`)
        .join('; ')}`,
      cause: lastError,
    });
  }

  private effectiveOrder(): string[] {
    const seen = new Set<string>();
    const order: string[] = [];
    for (const id of this.preferredOrder) {
      if (this.registry.has(id) && !seen.has(id)) {
        order.push(id);
        seen.add(id);
      }
    }
    for (const provider of this.registry.list()) {
      if (!seen.has(provider.descriptor.id)) {
        order.push(provider.descriptor.id);
        seen.add(provider.descriptor.id);
      }
    }
    return order;
  }
}

function toFallbackError(error: unknown, providerId: string): LLMError {
  if (error instanceof LLMError) {
    return error;
  }
  if (isCancelled(error)) {
    return cancelledError(providerId);
  }
  return new LLMError({
    code: 'unknown',
    providerId,
    message: error instanceof Error ? error.message : 'Provider failed.',
    cause: error,
  });
}

export const providerFallback = new ProviderFallback(providerRegistry, {
  order: config.llmFallbackOrder,
  enabled: config.llmFallbackEnabled,
});

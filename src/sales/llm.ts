import { runCompletion } from '../conversation-engine/index.js';
import { aiConfigStore, providerRegistry } from '../llm/index.js';
import { getSecret } from '../lib/secrets.js';
import type { LLMChatRequest } from '../llm/index.js';

/** True when at least one AI provider has a usable API key configured. */
export function isAiConfigured(): boolean {
  return providerRegistry.list().some((provider) => {
    const descriptor = provider.descriptor;
    return !descriptor.requiresApiKey || getSecret(descriptor.envVar).length > 0;
  });
}

export type SalesCompletion = {
  content: string;
  providerId: string;
};

/**
 * Runs a non-streaming completion through BRO's provider-fallback chain. Used
 * by the research / intelligence / pitch / next-best-action engines.
 */
export async function salesCompletion(
  request: LLMChatRequest,
  preferredProviderId?: string,
): Promise<SalesCompletion> {
  const providerId = preferredProviderId ?? (await aiConfigStore.get()).providerId ?? undefined;
  const result = await runCompletion(request, providerId);
  return { content: result.content, providerId: result.providerId };
}

/** Parses a strict-JSON LLM response, tolerating markdown code fences. */
export function parseStructuredJson<T>(raw: string): T | null {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*|```$/gi, '')
    .trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}

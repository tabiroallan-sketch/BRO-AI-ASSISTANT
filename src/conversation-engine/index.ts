import { getSecret } from '../lib/secrets.js';
import { aiConfigStore, modelManager, providerFallback } from '../llm/index.js';
import type { LLMChatRequest, LLMProvider, ProviderSettings } from '../llm/index.js';
import { buildSummaryInput, normalizeSummary } from './summary.js';
import { SUMMARY_MAX_LENGTH } from './types.js';
import type { ConversationState, HistoryEntry } from './types.js';

export * from './types.js';
export * from './state.js';
export * from './intent.js';
export * from './memory-recall.js';
export * from './clarify.js';
export * from './task.js';
export * from './summary.js';
export * from './context.js';

function envSettingsFor(provider: LLMProvider): ProviderSettings {
  return provider.descriptor.requiresApiKey
    ? { apiKey: getSecret(provider.descriptor.envVar) }
    : {};
}

/**
 * Runs a non-streaming completion through the same provider-fallback chain as
 * the main chat flow. Returns the raw completion content and the provider that
 * served it.
 */
export async function runCompletion(
  request: LLMChatRequest,
  preferredProviderId?: string,
): Promise<{ content: string; providerId: string }> {
  return providerFallback.execute(
    async (provider) => {
      await provider.initialize(envSettingsFor(provider));
      const model = await modelManager.resolveModel(provider.descriptor.id, request.model);
      const completion = await provider.completeChat({
        ...request,
        ...(model ? { model } : {}),
      });
      return { content: completion.content, providerId: provider.descriptor.id };
    },
    preferredProviderId ?? (await aiConfigStore.get()).providerId ?? undefined,
  );
}

export type SummaryResult = {
  summary: string;
  providerId?: string;
  truncatedInput: boolean;
};

const SUMMARY_SYSTEM_PROMPT =
  'You are a summarization engine. Condense the conversation transcript below into a ' +
  "rolling summary that preserves: the user's goals and preferences, any facts learned, " +
  'the current state of any ongoing work, and what the assistant last did. Write in the ' +
  'same language as the transcript. Keep it to 150 words or fewer. Respond with ONLY ' +
  'valid JSON in this exact shape: {"summary": "..."}';

/**
 * Summarizes the un-summarized tail of a conversation in the background. Pure
 * LLM concern; callers are expected to fire-and-forget (async best-effort).
 */
export async function summarizeConversation(
  history: HistoryEntry[],
  state: ConversationState,
  preferredProviderId?: string,
): Promise<SummaryResult> {
  const input = buildSummaryInput(history, state);
  if (!input.trim()) {
    return { summary: state.summary ?? '', truncatedInput: false };
  }
  const result = await runCompletion(
    {
      messages: [
        { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
        { role: 'user', content: input },
      ],
      temperature: 0.3,
      maxTokens: 400,
    },
    preferredProviderId,
  );

  const parsed = parseSummaryJson(result.content);
  const raw = parsed ?? stripMarkdownFence(result.content);
  return {
    summary: normalizeSummary(raw, state.summary),
    providerId: result.providerId,
    truncatedInput: input.length >= SUMMARY_MAX_LENGTH,
  };
}

function parseSummaryJson(raw: string): string | undefined {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object') {
      const summary = (parsed as Record<string, unknown>).summary;
      if (typeof summary === 'string' && summary.trim()) {
        return summary.trim();
      }
    }
  } catch {
    // Not JSON; fall through to the raw-text path.
  }
  return undefined;
}

function stripMarkdownFence(raw: string): string {
  const trimmed = raw.trim();
  return trimmed.replace(/^```(?:json)?\s*|```$/gi, '').trim();
}

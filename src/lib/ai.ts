import OpenAI from 'openai';
import { config } from '../config/index.js';

export type AiChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export function aiConfigured(): boolean {
  return config.openaiApiKey.length > 0;
}

function openaiClient(): OpenAI {
  if (!aiConfigured()) {
    throw new Error('OpenAI is not configured');
  }
  return new OpenAI({
    apiKey: config.openaiApiKey,
    ...(config.openaiBaseUrl ? { baseURL: config.openaiBaseUrl } : {}),
  });
}

export async function* streamChatCompletion(
  messages: AiChatMessage[],
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const stream = await openaiClient().chat.completions.create(
    {
      model: config.openaiModel,
      messages,
      stream: true,
    },
    signal ? { signal } : undefined,
  );

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) {
      yield delta;
    }
  }
}

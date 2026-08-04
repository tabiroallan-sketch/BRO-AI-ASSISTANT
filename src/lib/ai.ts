import OpenAI from 'openai';
import type {
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
  ChatCompletionMessageFunctionToolCall,
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
  ChatCompletionTool,
} from 'openai/resources/chat/completions';
import { config } from '../config/index.js';
import type { ToolParameterSchema } from '../tools/types.js';

export type AiToolCall = {
  id: string;
  name: string;
  arguments: string;
  extraContent?: Record<string, unknown>;
};

export type AiChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: AiToolCall[];
  tool_call_id?: string;
};

export type AiTool = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: ToolParameterSchema;
  };
};

export type AiCompletionResult = {
  content: string;
  toolCalls: AiToolCall[];
};

export type AiStreamEvent =
  { type: 'content'; content: string } | { type: 'tool_calls'; toolCalls: AiToolCall[] };

export function aiConfigured(): boolean {
  return config.openaiApiKey.length > 0;
}

let cachedClient: { client: OpenAI; apiKey: string; baseUrl: string } | null = null;

function openaiClient(): OpenAI {
  if (!aiConfigured()) {
    throw new Error('OpenAI is not configured');
  }
  const apiKey = config.openaiApiKey;
  const baseUrl = config.openaiBaseUrl ?? '';
  if (cachedClient && cachedClient.apiKey === apiKey && cachedClient.baseUrl === baseUrl) {
    return cachedClient.client;
  }
  const client = new OpenAI({
    apiKey,
    ...(baseUrl ? { baseURL: baseUrl } : {}),
  });
  cachedClient = { client, apiKey, baseUrl };
  return client;
}

export async function* streamChatCompletion(
  messages: AiChatMessage[],
  tools: AiTool[],
  signal?: AbortSignal,
): AsyncGenerator<AiStreamEvent> {
  const params: ChatCompletionCreateParamsStreaming = {
    model: config.openaiModel,
    messages: toWireMessages(messages),
    stream: true,
    ...(tools.length > 0 ? { tools: tools as unknown as ChatCompletionTool[] } : {}),
  };
  const stream = await openaiClient().chat.completions.create(
    params,
    signal ? { signal } : undefined,
  );

  const toolCallAccumulators = new Map<number, { id: string; name: string; arguments: string }>();
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta;
    if (delta?.content) {
      yield { type: 'content', content: delta.content };
    }
    for (const call of delta?.tool_calls ?? []) {
      const index = call.index ?? 0;
      const accumulator = toolCallAccumulators.get(index) ?? { id: '', name: '', arguments: '' };
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
  }

  if (toolCallAccumulators.size > 0) {
    const toolCalls: AiToolCall[] = [...toolCallAccumulators.entries()].map(([index, call]) => ({
      id: call.id || `call_${index}`,
      name: call.name,
      arguments: call.arguments,
    }));
    yield { type: 'tool_calls', toolCalls };
  }
}

export function toWireMessages(messages: AiChatMessage[]): ChatCompletionMessageParam[] {
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

export async function completeChat(
  messages: AiChatMessage[],
  tools: AiTool[],
  signal?: AbortSignal,
): Promise<AiCompletionResult> {
  const params: ChatCompletionCreateParamsNonStreaming = {
    model: config.openaiModel,
    messages: toWireMessages(messages),
    ...(tools.length > 0 ? { tools: tools as unknown as ChatCompletionTool[] } : {}),
  };
  const response = await openaiClient().chat.completions.create(
    params,
    signal ? { signal } : undefined,
  );

  const choice = response.choices[0]?.message;
  const toolCalls = (choice?.tool_calls ?? []).filter(
    (call): call is ChatCompletionMessageFunctionToolCall => 'function' in call,
  );
  return {
    content: choice?.content ?? '',
    toolCalls: toolCalls.map((call) => ({
      id: call.id,
      name: call.function.name,
      arguments: call.function.arguments,
      ...((call as unknown as { extra_content?: Record<string, unknown> }).extra_content
        ? {
            extraContent: (call as unknown as { extra_content: Record<string, unknown> })
              .extra_content,
          }
        : {}),
    })),
  };
}

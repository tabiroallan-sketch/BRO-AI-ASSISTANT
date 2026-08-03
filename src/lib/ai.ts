import OpenAI from 'openai';
import type {
  ChatCompletionCreateParamsNonStreaming,
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
      messages: toWireMessages(messages),
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

import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { HttpError, requireAuth } from '../lib/auth.js';
import { sanitizeOutputText, validateToolOutput } from '../lib/output-validate.js';
import { prisma } from '../lib/prisma.js';
import { getSecret } from '../lib/secrets.js';
import { getTool, listTools } from '../tools/registry.js';
import type { Tool } from '../tools/types.js';
import { aiConfigStore, modelManager, providerFallback, providerRegistry } from '../llm/index.js';
import type {
  LLMMessage,
  LLMProvider,
  LLMTool,
  LLMToolCall,
  ProviderSettings,
} from '../llm/index.js';

const chatSchema = z.object({
  conversationId: z.string().uuid().optional(),
  message: z.string().trim().min(1).max(4000),
});

const HISTORY_LIMIT = 30;
const TITLE_MAX = 60;
const MEMORY_LIMIT = 100;
const TOOL_CALL_LIMIT = 5;

const SYSTEM_PROMPT =
  'You are BRO, a helpful, concise AI assistant. Answer the user directly and ' +
  'accurately. Prefer short answers unless detail is requested.';

type MemoryFact = { key: string; value: string; category: string | null };

function buildSystemPrompt(memories: MemoryFact[]): string {
  if (memories.length === 0) {
    return SYSTEM_PROMPT;
  }
  const lines = memories.map((memory) => `- ${memory.key}: ${memory.value}`).join('\n');
  return (
    `${SYSTEM_PROMPT}\n\n` +
    `You have these stored facts about the user. Use them to personalize your ` +
    `answers; do not repeat them unless relevant.\n${lines}`
  );
}

function deriveTitle(message: string): string {
  const firstLine = message.split('\n')[0]?.trim() ?? '';
  const title = firstLine.length > TITLE_MAX ? `${firstLine.slice(0, TITLE_MAX)}…` : firstLine;
  return title || 'New conversation';
}

async function getOrCreateConversation(
  userId: string,
  conversationId: string | undefined,
  message: string,
): Promise<string> {
  if (conversationId) {
    const existing = await prisma?.conversation.findFirst({
      where: { id: conversationId, userId },
    });
    if (!existing) {
      throw new HttpError(404, 'Conversation not found');
    }
    return conversationId;
  }

  const conversation = await prisma?.conversation.create({
    data: { userId, title: deriveTitle(message) },
  });
  if (!conversation) {
    throw new HttpError(503, 'Database not configured');
  }
  return conversation.id;
}

function sendEvent(reply: FastifyReply, event: Record<string, unknown>): void {
  if (reply.raw.writableEnded || reply.raw.destroyed) {
    return;
  }
  reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
}

function toLLMRole(role: 'USER' | 'ASSISTANT' | 'SYSTEM'): LLMMessage['role'] {
  switch (role) {
    case 'USER':
      return 'user';
    case 'ASSISTANT':
      return 'assistant';
    default:
      return 'system';
  }
}

function toLLMTool(tool: Tool): LLMTool {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}

function envSettingsFor(provider: LLMProvider): ProviderSettings {
  return provider.descriptor.requiresApiKey
    ? { apiKey: getSecret(provider.descriptor.envVar) }
    : {};
}

function anyProviderConfigured(): boolean {
  return providerRegistry.list().some((provider) => {
    const descriptor = provider.descriptor;
    return !descriptor.requiresApiKey || getSecret(descriptor.envVar).length > 0;
  });
}

function parseToolArguments(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function attemptStatus(error: unknown): number | undefined {
  return (error as { status?: number }).status;
}

function deriveErrorMessage(error: unknown): string {
  const status = attemptStatus(error);
  if (status === 429) {
    return 'The AI provider is rate-limiting requests (429). Please wait a moment and try again.';
  }
  if (status === 401 || status === 403) {
    return 'The AI provider rejected the API key (unauthorized). Check the provider key and quota.';
  }
  const code = (error as { code?: string }).code;
  if (code === 'rate_limited') {
    return 'The AI provider is rate-limiting requests. Please wait a moment and try again.';
  }
  if (code === 'auth_failed') {
    return 'The AI provider rejected the API key (unauthorized). Check the provider key and quota.';
  }
  if (code === 'timeout') {
    return 'The AI provider timed out. Please try again.';
  }
  if (code === 'network' || code === 'stream_interrupted') {
    return 'Network error while contacting the AI provider.';
  }
  if (code === 'model_unavailable') {
    return 'The requested AI model is unavailable.';
  }
  return 'Failed to generate a response';
}

async function runModel(
  provider: LLMProvider,
  messages: LLMMessage[],
  tools: LLMTool[],
  signal: AbortSignal,
  onContent: (delta: string) => void,
): Promise<{ content: string; toolCalls: LLMToolCall[] }> {
  let content = '';
  let toolCalls: LLMToolCall[] = [];

  async function consume(currentMessages: LLMMessage[], currentTools: LLMTool[]): Promise<void> {
    const model = await modelManager.resolveModel(provider.descriptor.id);
    const stream = provider.streamChat(
      {
        messages: currentMessages,
        ...(currentTools.length > 0 ? { tools: currentTools } : {}),
        ...(model ? { model } : {}),
      },
      { signal },
    );
    for await (const event of stream) {
      if (event.type === 'content') {
        content += event.content;
        onContent(event.content);
      } else if (event.type === 'tool_calls') {
        toolCalls = event.toolCalls;
      }
    }
  }

  try {
    await consume(messages, tools);
  } catch (error) {
    // The client disconnected: do not retry and do not keep generating.
    if (signal.aborted) {
      throw error;
    }
    // Some OpenAI-compatible providers (e.g. Gemini) reject requests whose
    // final turn is a tool result or an assistant tool_call. Retry once with a
    // closing user turn so the model can produce its answer.
    const last = messages[messages.length - 1];
    const endsOnToolTurn =
      last?.role === 'tool' || (last?.role === 'assistant' && (last.tool_calls?.length ?? 0) > 0);
    if (endsOnToolTurn) {
      try {
        await consume([...messages, { role: 'user', content: 'Continue.' }], tools);
        return { content, toolCalls };
      } catch {
        // Fall through to the plain-completion fallback below.
      }
    }
    // Some providers reject the tools array; fall back to a plain completion.
    if (tools.length > 0) {
      toolCalls = [];
      await consume(messages, []);
    } else {
      throw error;
    }
  }

  return { content, toolCalls };
}

async function runModelWithFallback(
  messages: LLMMessage[],
  tools: LLMTool[],
  signal: AbortSignal,
  onContent: (delta: string) => void,
  preferredProviderId?: string,
): Promise<{ content: string; toolCalls: LLMToolCall[] }> {
  return providerFallback.execute(async (provider) => {
    await provider.initialize(envSettingsFor(provider));
    return runModel(provider, messages, tools, signal, onContent);
  }, preferredProviderId);
}

async function executeTool(
  call: LLMToolCall,
  args: Record<string, unknown>,
  userId: string,
): Promise<{ ok: boolean; output: string }> {
  const tool = getTool(call.name);
  if (!tool) {
    return { ok: false, output: `Error: unknown tool "${call.name}"` };
  }
  try {
    const output = validateToolOutput(await tool.execute(args, { userId }));
    return { ok: true, output };
  } catch (error) {
    return {
      ok: false,
      output: `Error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export async function chatRoutes(app: FastifyInstance): Promise<void> {
  app.post('/chat', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = chatSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new HttpError(400, 'Invalid request body');
    }
    const userId = request.user?.id;
    if (!userId) {
      throw new HttpError(401, 'Unauthorized');
    }
    if (!prisma) {
      throw new HttpError(503, 'Database not configured');
    }

    if (!anyProviderConfigured()) {
      throw new HttpError(503, 'AI is not configured');
    }

    const { conversationId, message } = parsed.data;
    const conversation = await getOrCreateConversation(userId, conversationId, message);

    const userMessage = await prisma.message.create({
      data: { conversationId: conversation, role: 'USER', content: message },
    });
    await prisma.conversation.update({
      where: { id: conversation },
      data: { updatedAt: new Date() },
    });

    const history = await prisma.message.findMany({
      where: { conversationId: conversation },
      orderBy: { createdAt: 'desc' },
      take: HISTORY_LIMIT,
      select: { role: true, content: true },
    });
    history.reverse();

    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    sendEvent(reply, { type: 'start', conversationId: conversation, messageId: userMessage.id });

    const abortController = new AbortController();
    const onAbort = (): void => abortController.abort();
    request.raw.once('close', onAbort);

    let full = '';
    try {
      const memories = await prisma.memory.findMany({
        where: { userId },
        take: MEMORY_LIMIT,
        select: { key: true, value: true, category: true },
      });

      const llmMessages: LLMMessage[] = [
        { role: 'system', content: buildSystemPrompt(memories) },
        ...history.map((entry) => ({
          role: toLLMRole(entry.role),
          content: entry.content,
        })),
      ];
      const tools: LLMTool[] = listTools().map(toLLMTool);
      const preferredProviderId = (await aiConfigStore.get()).providerId ?? undefined;

      for (let round = 0; round <= TOOL_CALL_LIMIT; round += 1) {
        const { content, toolCalls } = await runModelWithFallback(
          llmMessages,
          tools,
          abortController.signal,
          (delta) => sendEvent(reply, { type: 'delta', content: sanitizeOutputText(delta) }),
          preferredProviderId,
        );
        if (toolCalls.length === 0) {
          full = content;
          break;
        }
        if (round === TOOL_CALL_LIMIT) {
          full = content || 'I could not finish before running out of tool calls. Try again.';
          break;
        }

        llmMessages.push({ role: 'assistant', content: null, tool_calls: toolCalls });
        for (const call of toolCalls) {
          if (abortController.signal.aborted) {
            throw abortController.signal.reason ?? new Error('Client disconnected');
          }
          const args = parseToolArguments(call.arguments);
          sendEvent(reply, { type: 'tool_start', name: call.name, args });
          const result = await executeTool(call, args, userId);
          sendEvent(reply, {
            type: 'tool_result',
            name: call.name,
            ok: result.ok,
            output: result.output,
          });
          llmMessages.push({ role: 'tool', tool_call_id: call.id, content: result.output });
        }
      }

      full = sanitizeOutputText(full);

      const assistantMessage = await prisma.message.create({
        data: { conversationId: conversation, role: 'ASSISTANT', content: full },
      });
      await prisma.conversation.update({
        where: { id: conversation },
        data: { updatedAt: new Date() },
      });

      sendEvent(reply, {
        type: 'done',
        message: {
          id: assistantMessage.id,
          role: 'ASSISTANT',
          content: assistantMessage.content,
          createdAt: assistantMessage.createdAt,
        },
      });
    } catch (error) {
      request.log.error({ err: error }, 'Chat stream failed');
      if (full) {
        try {
          const assistantMessage = await prisma.message.create({
            data: {
              conversationId: conversation,
              role: 'ASSISTANT',
              content: sanitizeOutputText(full),
            },
          });
          await prisma.conversation.update({
            where: { id: conversation },
            data: { updatedAt: new Date() },
          });
          sendEvent(reply, {
            type: 'done',
            message: {
              id: assistantMessage.id,
              role: 'ASSISTANT',
              content: assistantMessage.content,
              createdAt: assistantMessage.createdAt,
            },
          });
        } catch {
          // Nothing left to do; the error event below still surfaces the failure.
        }
      }
      sendEvent(reply, { type: 'error', message: deriveErrorMessage(error) });
    } finally {
      request.raw.off('close', onAbort);
      reply.raw.end();
    }
  });
}

import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { config } from '../config/index.js';
import { HttpError, requireAuth } from '../lib/auth.js';
import { sanitizeOutputText, validateToolOutput } from '../lib/output-validate.js';
import { prisma } from '../lib/prisma.js';
import type { Prisma } from '../lib/prisma.js';
import { getSecret } from '../lib/secrets.js';
import { getTool, listTools } from '../tools/registry.js';
import type { Tool } from '../tools/types.js';
import {
  aiConfigStore,
  LLMError,
  modelManager,
  providerFallback,
  providerRegistry,
} from '../llm/index.js';
import {
  buildIntegrationAwareness,
  formatIntegrationAwareness,
} from '../llm/integration-awareness.js';
import {
  CONTEXT_RECENT_LIMIT,
  MEMORY_RANK_TOP_K,
  buildContextBlock,
  buildHistoryWindow,
  classifyIntent,
  extractFollowupCandidates,
  formatContextBlock,
  needsClarification,
  parseConversationState,
  rankMemories,
  recordPendingTask,
  serializeConversationState,
  shouldSummarize,
  summarizeConversation,
  type ConversationIntent,
  type ConversationState,
  type HistoryEntry,
} from '../conversation-engine/index.js';
import { isProviderError } from '../integrations/errors.js';
import { toUserMessage } from '../integrations/errors.js';
import { getProvider } from '../integrations/providers.js';
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

const FULL_HISTORY_LIMIT = 500;
const TITLE_MAX = 60;
const MEMORY_LIMIT = 100;
const TOOL_CALL_LIMIT = 5;
const ROUND_TIMEOUT_MS = 90_000;

const SYSTEM_PROMPT =
  'You are BRO, a helpful, concise AI assistant. Answer the user directly and ' +
  'accurately. Prefer short answers unless detail is requested.\n' +
  'Use tools sparingly. Never call a tool for casual conversation, greetings, or ' +
  'questions you can answer from your own knowledge. Only call a tool when the ' +
  'user asks for something that genuinely requires fetching live data or ' +
  'performing an action. When you do use a tool, never describe the tool call ' +
  'itself: use its output to answer the user naturally, in your own words, as if ' +
  'you performed the action yourself.';

function buildSystemPrompt(
  contextBlock: ReturnType<typeof buildContextBlock>,
  integrationAwareness: ReturnType<typeof formatIntegrationAwareness>,
): string {
  const parts = [SYSTEM_PROMPT];
  const engineBlock = formatContextBlock(contextBlock);
  if (engineBlock) {
    parts.push(engineBlock);
  }
  if (integrationAwareness) {
    parts.push(integrationAwareness);
  }
  return parts.join('\n\n');
}

function deriveTitle(message: string): string {
  const firstLine = message.split('\n')[0]?.trim() ?? '';
  const title = firstLine.length > TITLE_MAX ? `${firstLine.slice(0, TITLE_MAX)}…` : firstLine;
  return title || 'New conversation';
}

async function persistConversationState(
  conversationId: string,
  state: ConversationState,
): Promise<void> {
  await prisma?.conversation.update({
    where: { id: conversationId },
    data: { metadata: serializeConversationState(state) as unknown as Prisma.InputJsonValue },
  });
}

async function getOrCreateConversation(
  userId: string,
  conversationId: string | undefined,
  message: string,
): Promise<{ id: string; metadata: unknown }> {
  if (conversationId) {
    const existing = await prisma?.conversation.findFirst({
      where: { id: conversationId, userId },
    });
    if (!existing) {
      throw new HttpError(404, 'Conversation not found');
    }
    return { id: conversationId, metadata: existing.metadata ?? null };
  }

  const conversation = await prisma?.conversation.create({
    data: { userId, title: deriveTitle(message) },
  });
  if (!conversation) {
    throw new HttpError(503, 'Database not configured');
  }
  return { id: conversation.id, metadata: null };
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
    // A slow provider is not going to get faster by retrying the same prompt;
    // surface the timeout so the route can answer from tool output or error.
    if ((error as { code?: string }).code === 'timeout') {
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

type ToolExecutionResult = {
  ok: boolean;
  output: string;
  /** Present when the tool failed because the account is not connected. */
  connectProviderId?: string;
  connectLabel?: string;
  permissionDenied?: boolean;
};

async function executeTool(
  call: LLMToolCall,
  args: Record<string, unknown>,
  userId: string,
): Promise<ToolExecutionResult> {
  const tool = getTool(call.name);
  if (!tool) {
    return { ok: false, output: `Error: unknown tool "${call.name}"` };
  }
  try {
    const output = validateToolOutput(await tool.execute(args, { userId }));
    return { ok: true, output };
  } catch (error) {
    if (isProviderError(error)) {
      const provider = getProvider(error.providerId);
      const label = provider?.label ?? error.providerId;
      if (error.code === 'TOKEN_MISSING') {
        return {
          ok: false,
          connectProviderId: error.providerId,
          connectLabel: label,
          output:
            `The user's ${label} account is not connected. Tell the user you need permission to ` +
            `connect their ${label} account to do this, and name the service; a Connect button will ` +
            `appear in the interface. Do not call this tool again.`,
        };
      }
      return {
        ok: false,
        output: toUserMessage(error),
        permissionDenied: error.code === 'PERMISSION_DENIED',
      };
    }
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
    const { id: conversation, metadata } = await getOrCreateConversation(
      userId,
      conversationId,
      message,
    );
    const conversationState = parseConversationState(metadata);

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
      take: FULL_HISTORY_LIMIT,
      select: { role: true, content: true },
    });
    history.reverse();
    const historyEntries: HistoryEntry[] = history.map((entry) => ({
      role: entry.role,
      content: entry.content,
    }));

    const lastAssistant = [...historyEntries]
      .reverse()
      .find((entry) => entry.role === 'ASSISTANT')?.content;
    const intent: ConversationIntent = classifyIntent(message, lastAssistant);
    try {
      await prisma.message.update({
        where: { id: userMessage.id },
        data: { metadata: { v: 1, intent } },
      });
    } catch (error) {
      request.log.warn({ err: error }, 'Failed to persist message intent');
    }

    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      // reply.hijack() bypasses @fastify/cors (which attaches headers in its
      // onSend hook), so the hijacked SSE response must carry the CORS headers
      // itself or the browser will drop the stream for cross-origin requests.
      'Access-Control-Allow-Origin': config.corsOrigin,
      'Access-Control-Allow-Credentials': 'true',
    });
    sendEvent(reply, { type: 'start', conversationId: conversation, messageId: userMessage.id });

    const abortController = new AbortController();
    const onAbort = (): void => abortController.abort();
    request.raw.once('close', onAbort);

    let full = '';
    let taskUnfinished = false;
    try {
      const memoriesPromise = prisma.memory.findMany({
        where: { userId },
        take: MEMORY_LIMIT,
        select: { key: true, value: true, category: true, updatedAt: true },
      });
      const [allMemories, integrationAwareness] = await Promise.all([
        memoriesPromise,
        buildIntegrationAwareness(userId),
      ]);

      const recentHistory = [...historyEntries]
        .slice(-CONTEXT_RECENT_LIMIT)
        .map((entry) => entry.content)
        .join('\n');
      const rankedMemories = rankMemories(allMemories, message, recentHistory, MEMORY_RANK_TOP_K);
      const clarify = needsClarification(message, intent, allMemories.length > 0);
      const contextBlock = buildContextBlock(
        historyEntries,
        conversationState,
        rankedMemories,
        intent,
        clarify
          ? "The user's request is vague or incomplete. Ask one short clarifying question instead of guessing what they mean."
          : undefined,
      );

      const { recent } = buildHistoryWindow(historyEntries, conversationState);
      const llmMessages: LLMMessage[] = [
        {
          role: 'system',
          content: buildSystemPrompt(
            contextBlock,
            formatIntegrationAwareness(integrationAwareness),
          ),
        },
        ...recent.map((entry) => ({
          role: toLLMRole(entry.role),
          content: entry.content,
        })),
      ];
      const tools: LLMTool[] = listTools().map(toLLMTool);
      const preferredProviderId = (await aiConfigStore.get()).providerId ?? undefined;

      const toolOutputs: string[] = [];

      for (let round = 0; round <= TOOL_CALL_LIMIT; round += 1) {
        const roundTools = round === 0 ? tools : [];
        const roundController = new AbortController();
        const forwardAbort = (): void => roundController.abort();
        abortController.signal.addEventListener('abort', forwardAbort, { once: true });

        let timer: ReturnType<typeof setTimeout> | undefined;
        let timedOut = false;
        const timeoutPromise = new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            timedOut = true;
            roundController.abort();
            reject(
              new LLMError({
                code: 'timeout',
                providerId: 'unknown',
                message: 'The AI provider timed out.',
                retryable: false,
              }),
            );
          }, ROUND_TIMEOUT_MS);
        });

        try {
          const modelCall = runModelWithFallback(
            llmMessages,
            roundTools,
            roundController.signal,
            (delta) => sendEvent(reply, { type: 'delta', content: sanitizeOutputText(delta) }),
            preferredProviderId,
          );
          const { content, toolCalls } = await Promise.race([modelCall, timeoutPromise]);
          if (toolCalls.length === 0) {
            full = content;
            break;
          }
          if (round === TOOL_CALL_LIMIT) {
            full = content || 'I could not finish before running out of tool calls. Try again.';
            taskUnfinished = true;
            break;
          }

          llmMessages.push({ role: 'assistant', content: null, tool_calls: toolCalls });
          for (const toolCall of toolCalls) {
            if (abortController.signal.aborted) {
              throw abortController.signal.reason ?? new Error('Client disconnected');
            }
            const args = parseToolArguments(toolCall.arguments);
            sendEvent(reply, { type: 'tool_start', name: toolCall.name, args });
            const result = await executeTool(toolCall, args, userId);
            sendEvent(reply, {
              type: 'tool_result',
              name: toolCall.name,
              ok: result.ok,
              output: result.output,
              ...(result.connectProviderId
                ? {
                    connectProviderId: result.connectProviderId,
                    connectLabel: result.connectLabel,
                  }
                : {}),
              ...(result.permissionDenied ? { permissionDenied: true } : {}),
            });
            toolOutputs.push(result.output);
            llmMessages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: result.output,
            });
          }
          const executedTools = toolCalls.map((call) => getTool(call.name));
          const allAnswerFinal =
            executedTools.length > 0 && executedTools.every((tool) => Boolean(tool?.answerFinal));
          if (allAnswerFinal) {
            full = toolOutputs.join('\n');
            break;
          }
        } catch (error) {
          if (abortController.signal.aborted) {
            throw error;
          }
          if (timedOut) {
            request.log.warn(
              { err: error, round },
              `Model round timed out after ${ROUND_TIMEOUT_MS}ms`,
            );
            if (toolOutputs.length > 0) {
              request.log.warn(
                { round },
                'Final answer not generated; replying with tool output instead',
              );
              full = toolOutputs.join('\n');
              break;
            }
            throw error;
          }
          if (toolOutputs.length > 0) {
            request.log.warn(
              { err: error, round },
              'Final answer not generated; replying with tool output instead',
            );
            full = toolOutputs.join('\n');
            break;
          }
          throw error;
        } finally {
          if (timer) {
            clearTimeout(timer);
          }
          abortController.signal.removeEventListener('abort', forwardAbort);
        }
      }

      full = sanitizeOutputText(full);

      const suggestions = extractFollowupCandidates(full);
      let nextState: ConversationState = {
        ...conversationState,
        suggestions,
      };
      if (taskUnfinished) {
        nextState = recordPendingTask(nextState, message);
      } else if (intent !== 'continuation') {
        nextState = { ...nextState, pendingTask: undefined, pendingTaskAt: undefined };
      }

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
          ...(suggestions.length > 0 ? { suggestions } : {}),
        },
      });

      persistConversationState(conversation, nextState).catch((error) =>
        request.log.warn({ err: error }, 'Failed to persist conversation state'),
      );

      if (shouldSummarize(nextState, historyEntries.length)) {
        summarizeConversation(historyEntries, nextState, preferredProviderId)
          .then((result) =>
            persistConversationState(conversation, {
              ...nextState,
              summary: result.summary,
              summaryMessageCount: historyEntries.length,
            }),
          )
          .catch((error) =>
            request.log.warn({ err: error }, 'Background conversation summary failed'),
          );
      }
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

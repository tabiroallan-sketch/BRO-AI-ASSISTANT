import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  aiConfigured,
  completeChat,
  type AiChatMessage,
  type AiCompletionResult,
  type AiTool,
  type AiToolCall,
} from '../lib/ai.js';
import { HttpError, requireAuth } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';
import { getTool, listTools } from '../tools/registry.js';
import type { Tool } from '../tools/types.js';

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
  reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
}

function toAiRole(role: 'USER' | 'ASSISTANT' | 'SYSTEM'): AiChatMessage['role'] {
  switch (role) {
    case 'USER':
      return 'user';
    case 'ASSISTANT':
      return 'assistant';
    default:
      return 'system';
  }
}

function toAiTool(tool: Tool): AiTool {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}

function parseToolArguments(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function chunkText(text: string, size = 64): string[] {
  if (!text) {
    return [];
  }
  if (text.length <= size) {
    return [text];
  }
  const chunks: string[] = [];
  let current = '';
  for (const word of text.split(/\s+/)) {
    if (current && current.length + 1 + word.length > size) {
      chunks.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) {
    chunks.push(current);
  }
  return chunks;
}

async function runModel(
  messages: AiChatMessage[],
  tools: AiTool[],
  signal?: AbortSignal,
): Promise<AiCompletionResult> {
  try {
    return await completeChat(messages, tools, signal);
  } catch (error) {
    // Some providers reject the tools array; fall back to a plain completion.
    if (tools.length > 0) {
      return await completeChat(messages, [], signal);
    }
    throw error;
  }
}

async function executeTool(
  call: AiToolCall,
  args: Record<string, unknown>,
  userId: string,
): Promise<{ ok: boolean; output: string }> {
  const tool = getTool(call.name);
  if (!tool) {
    return { ok: false, output: `Error: unknown tool "${call.name}"` };
  }
  try {
    const output = await tool.execute(args, { userId });
    return { ok: true, output: String(output) };
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
    if (!aiConfigured()) {
      throw new HttpError(503, 'AI is not configured');
    }
    if (!prisma) {
      throw new HttpError(503, 'Database not configured');
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

      const aiMessages: AiChatMessage[] = [
        { role: 'system', content: buildSystemPrompt(memories) },
        ...history.map((entry) => ({
          role: toAiRole(entry.role),
          content: entry.content,
        })),
      ];
      const tools: AiTool[] = listTools().map(toAiTool);

      for (let round = 0; round <= TOOL_CALL_LIMIT; round += 1) {
        const { content, toolCalls } = await runModel(aiMessages, tools, abortController.signal);
        if (toolCalls.length === 0) {
          full = content;
          break;
        }
        if (round === TOOL_CALL_LIMIT) {
          full = content || 'I could not finish before running out of tool calls. Try again.';
          break;
        }

        aiMessages.push({ role: 'assistant', content: null, tool_calls: toolCalls });
        for (const call of toolCalls) {
          const args = parseToolArguments(call.arguments);
          sendEvent(reply, { type: 'tool_start', name: call.name, args });
          const result = await executeTool(call, args, userId);
          sendEvent(reply, {
            type: 'tool_result',
            name: call.name,
            ok: result.ok,
            output: result.output,
          });
          aiMessages.push({ role: 'tool', tool_call_id: call.id, content: result.output });
        }
      }

      for (const delta of chunkText(full)) {
        sendEvent(reply, { type: 'delta', content: delta });
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
        },
      });
    } catch (error) {
      request.log.error({ err: error }, 'Chat stream failed');
      if (full) {
        try {
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
        } catch {
          // Nothing left to do; the error event below still surfaces the failure.
        }
      }
      sendEvent(reply, { type: 'error', message: 'Failed to generate a response' });
    } finally {
      request.raw.off('close', onAbort);
      reply.raw.end();
    }
  });
}

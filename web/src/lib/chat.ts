import { API_BASE_URL, ApiError, request } from '@/lib/api';
import { getAccessToken } from '@/lib/token-store';

export type MessageRole = 'USER' | 'ASSISTANT' | 'SYSTEM';

export type ChatMessage = {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: string;
};

export type Conversation = {
  id: string;
  title: string | null;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
};

export type ConversationDetail = Conversation & {
  messages: ChatMessage[];
};

export type ToolActivity = {
  name: string;
  args: Record<string, unknown>;
  ok?: boolean;
  output?: string;
};

export type StreamEvent =
  | { type: 'start'; conversationId: string; messageId: string }
  | { type: 'tool_start'; name: string; args: Record<string, unknown> }
  | { type: 'tool_result'; name: string; ok: boolean; output: string }
  | { type: 'delta'; content: string }
  | { type: 'done'; message: ChatMessage }
  | { type: 'error'; message: string };

function authToken(): string {
  const token = getAccessToken();
  if (!token) {
    throw new ApiError(401, 'Not authenticated');
  }
  return token;
}

export async function listConversations(): Promise<Conversation[]> {
  const result = await request<{ conversations: Conversation[] }>('/conversations', {
    token: authToken(),
  });
  return result.conversations;
}

export async function createConversation(title?: string): Promise<Conversation> {
  const result = await request<{ conversation: Conversation }>('/conversations', {
    method: 'POST',
    token: authToken(),
    body: title ? { title } : {},
  });
  return result.conversation;
}

export async function getConversation(id: string): Promise<ConversationDetail> {
  const result = await request<{ conversation: ConversationDetail }>(`/conversations/${id}`, {
    token: authToken(),
  });
  return result.conversation;
}

export async function renameConversation(id: string, title: string): Promise<Conversation> {
  const result = await request<{ conversation: Conversation }>(`/conversations/${id}`, {
    method: 'PATCH',
    token: authToken(),
    body: { title },
  });
  return result.conversation;
}

export async function deleteConversation(id: string): Promise<void> {
  await request<void>(`/conversations/${id}`, {
    method: 'DELETE',
    token: authToken(),
  });
}

export async function* parseSseStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<StreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  function processBuffer(): StreamEvent[] {
    const events: StreamEvent[] = [];
    const blocks = buffer.split('\n\n');
    buffer = blocks.pop() ?? '';
    for (const block of blocks) {
      for (const line of block.split('\n')) {
        if (!line.startsWith('data: ')) {
          continue;
        }
        try {
          events.push(JSON.parse(line.slice('data: '.length)) as StreamEvent);
        } catch {
          // Ignore malformed events; the stream continues.
        }
      }
    }
    return events;
  }

  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    for (const event of processBuffer()) {
      yield event;
    }
  }

  buffer += decoder.decode();
  for (const event of parseAll(buffer)) {
    yield event;
  }
}

function parseAll(text: string): StreamEvent[] {
  const events: StreamEvent[] = [];
  for (const block of text.split('\n\n')) {
    for (const line of block.split('\n')) {
      if (!line.startsWith('data: ')) {
        continue;
      }
      try {
        events.push(JSON.parse(line.slice('data: '.length)) as StreamEvent);
      } catch {
        // Ignore malformed events; the stream continues.
      }
    }
  }
  return events;
}

export async function streamChat(
  message: string,
  conversationId?: string,
): Promise<AsyncGenerator<StreamEvent>> {
  const response = await fetch(`${API_BASE_URL}/chat`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${getAccessToken() ?? ''}`,
    },
    body: JSON.stringify({ message, ...(conversationId ? { conversationId } : {}) }),
  });

  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    throw new ApiError(
      response.status,
      data?.error?.message ?? `Request failed (${response.status})`,
    );
  }

  if (!response.body) {
    throw new ApiError(502, 'Response stream unavailable');
  }

  return parseSseStream(response.body);
}

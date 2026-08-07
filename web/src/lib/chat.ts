import { API_BASE_URL, ApiError, refresh as refreshTokens, request } from '@/lib/api';
import { getAccessToken, setTokens } from '@/lib/token-store';

export type MessageRole = 'USER' | 'ASSISTANT' | 'SYSTEM';

export type ChatMessage = {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: string;
  /** One-tap follow-up questions suggested by the assistant. */
  suggestions?: string[];
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
  /** Rolling summary of the earlier part of the conversation, if any. */
  summary?: string | null;
  /** Follow-up suggestions from the most recent assistant reply. */
  suggestions?: string[];
};

export type ToolActivity = {
  name: string;
  args: Record<string, unknown>;
  ok?: boolean;
  output?: string;
  /** Present when the tool failed because the account is not connected. */
  connectProviderId?: string;
  connectLabel?: string;
  permissionDenied?: boolean;
  /** Set when a tool needs explicit user approval before it can run. */
  confirmationId?: string;
  confirmationSummary?: string;
};

export type StreamEvent =
  | { type: 'start'; conversationId: string; messageId: string }
  | { type: 'tool_start'; name: string; args: Record<string, unknown> }
  | {
      type: 'tool_confirmation';
      id: string;
      name: string;
      args: Record<string, unknown>;
      summary: string;
    }
  | {
      type: 'tool_result';
      name: string;
      ok: boolean;
      output: string;
      connectProviderId?: string;
      connectLabel?: string;
      permissionDenied?: boolean;
    }
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
  const result = await request<{
    conversation: ConversationDetail;
    summary?: string | null;
    suggestions?: string[];
  }>(`/conversations/${id}`, {
    token: authToken(),
  });
  return {
    ...result.conversation,
    summary: result.summary ?? null,
    suggestions: result.suggestions ?? [],
  };
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

async function postChat(message: string, conversationId?: string): Promise<Response> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    authorization: `Bearer ${getAccessToken() ?? ''}`,
  };
  const body = JSON.stringify({ message, ...(conversationId ? { conversationId } : {}) });

  const response = await fetch(`${API_BASE_URL}/chat`, {
    method: 'POST',
    headers,
    body,
  });

  if (response.status === 401) {
    try {
      const refreshed = await refreshTokens();
      setTokens(refreshed.accessToken, refreshed.refreshToken);
      headers.authorization = `Bearer ${refreshed.accessToken}`;
      return await fetch(`${API_BASE_URL}/chat`, {
        method: 'POST',
        headers,
        body,
      });
    } catch {
      return response;
    }
  }

  return response;
}

export async function streamChat(
  message: string,
  conversationId?: string,
): Promise<AsyncGenerator<StreamEvent>> {
  const response = await postChat(message, conversationId);

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

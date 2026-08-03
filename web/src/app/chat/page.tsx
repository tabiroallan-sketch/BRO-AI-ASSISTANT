'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { MessageSquare } from 'lucide-react';
import { RequireAuth } from '@/components/require-auth';
import { ChatInput } from '@/components/chat/chat-input';
import { ConversationList } from '@/components/chat/conversation-list';
import { MessageBubble } from '@/components/chat/message-bubble';
import { ApiError } from '@/lib/api';
import type { ChatMessage, Conversation } from '@/lib/chat';
import {
  deleteConversation,
  getConversation,
  listConversations,
  renameConversation,
  streamChat,
} from '@/lib/chat';
import { useAuth } from '@/lib/auth';

function TypingIndicator(): React.JSX.Element {
  return (
    <div className="flex gap-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border bg-muted">
        <MessageSquare className="h-4 w-4" />
      </div>
      <div className="flex items-center gap-1 rounded-2xl border bg-card px-4 py-3">
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:120ms]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:240ms]" />
      </div>
    </div>
  );
}

export default function ChatPage(): React.JSX.Element {
  const router = useRouter();
  const { logout } = useAuth();
  const [conversations, setConversations] = React.useState<Conversation[]>([]);
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = React.useState(false);
  const [streamingContent, setStreamingContent] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [loadingList, setLoadingList] = React.useState(true);
  const bottomRef = React.useRef<HTMLDivElement>(null);

  async function loadConversations(): Promise<void> {
    try {
      setConversations(await listConversations());
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        await logout();
        router.replace('/login');
        return;
      }
      setError('Failed to load conversations.');
    } finally {
      setLoadingList(false);
    }
  }

  React.useEffect(() => {
    void loadConversations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent, streaming]);

  async function selectConversation(id: string): Promise<void> {
    if (streaming) {
      return;
    }
    setError(null);
    try {
      const conversation = await getConversation(id);
      setActiveId(id);
      setMessages(conversation.messages);
      setStreamingContent('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load conversation.');
    }
  }

  function startNewChat(): void {
    if (streaming) {
      return;
    }
    setError(null);
    setActiveId(null);
    setMessages([]);
    setStreamingContent('');
  }

  async function handleSend(message: string): Promise<void> {
    if (streaming) {
      return;
    }
    setError(null);

    const optimistic: ChatMessage = {
      id: `temp-${Date.now()}`,
      role: 'USER',
      content: message,
      createdAt: new Date().toISOString(),
    };
    setMessages((current) => [...current, optimistic]);
    setStreaming(true);
    setStreamingContent('');

    try {
      const events = await streamChat(message, activeId ?? undefined);
      for await (const event of events) {
        if (event.type === 'start') {
          setActiveId(event.conversationId);
        } else if (event.type === 'delta') {
          setStreamingContent((current) => current + event.content);
        } else if (event.type === 'done') {
          setStreamingContent('');
          setMessages((current) => [...current, event.message]);
          setStreaming(false);
          void loadConversations();
        } else if (event.type === 'error') {
          setStreamingContent('');
          setStreaming(false);
          setError(event.message);
          void loadConversations();
        }
      }
    } catch (err) {
      setStreamingContent('');
      setStreaming(false);
      setError(err instanceof ApiError ? err.message : 'Failed to send message.');
    }
  }

  async function handleRename(id: string, title: string): Promise<void> {
    await renameConversation(id, title);
    await loadConversations();
  }

  async function handleDelete(id: string): Promise<void> {
    await deleteConversation(id);
    if (activeId === id) {
      setActiveId(null);
      setMessages([]);
    }
    await loadConversations();
  }

  const hasThread = activeId !== null || messages.length > 0;

  return (
    <RequireAuth>
      <div className="flex h-[calc(100dvh-3.5rem)]">
        <ConversationList
          conversations={conversations}
          activeId={activeId}
          onSelect={(id) => void selectConversation(id)}
          onNew={startNewChat}
          onRename={handleRename}
          onDelete={handleDelete}
        />
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex-1 space-y-6 overflow-y-auto p-4 sm:p-6">
            {!hasThread && !loadingList && (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full border bg-muted">
                  <MessageSquare className="h-6 w-6" />
                </div>
                <h2 className="text-xl font-semibold">Start a conversation with BRO</h2>
                <p className="max-w-md text-sm text-muted-foreground">
                  Ask anything. Conversations are saved automatically and you can return to them
                  from the sidebar.
                </p>
              </div>
            )}
            {messages.map((entry) => (
              <MessageBubble key={entry.id} role={entry.role} content={entry.content} />
            ))}
            {streaming && streamingContent.length === 0 && <TypingIndicator />}
            {streaming && streamingContent.length > 0 && (
              <MessageBubble role="ASSISTANT" content={streamingContent} streaming />
            )}
            <div ref={bottomRef} />
          </div>
          {error && <p className="border-t px-4 py-2 text-sm text-destructive">{error}</p>}
          <ChatInput disabled={streaming} onSend={(message) => void handleSend(message)} />
        </main>
      </div>
    </RequireAuth>
  );
}

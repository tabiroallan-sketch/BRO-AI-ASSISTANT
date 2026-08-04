'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { MessageSquare } from 'lucide-react';
import { RequireAuth } from '@/components/require-auth';
import { ChatInput } from '@/components/chat/chat-input';
import { ConversationList } from '@/components/chat/conversation-list';
import { MessageBubble } from '@/components/chat/message-bubble';
import { ApiError } from '@/lib/api';
import type { ChatMessage, Conversation, ToolActivity } from '@/lib/chat';
import {
  deleteConversation,
  getConversation,
  listConversations,
  renameConversation,
  streamChat,
} from '@/lib/chat';
import { useAuth } from '@/lib/auth';
import { ToolBubble } from '@/components/chat/tool-bubble';

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
  const [toolActivity, setToolActivity] = React.useState<ToolActivity[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [loadingList, setLoadingList] = React.useState(true);
  const bottomRef = React.useRef<HTMLDivElement>(null);
  const busyRef = React.useRef(false);

  const loadConversations = React.useCallback(async (): Promise<void> => {
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
  }, [logout, router]);

  React.useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent, toolActivity, streaming]);

  const selectConversation = React.useCallback(async (id: string): Promise<void> => {
    if (busyRef.current) {
      return;
    }
    setError(null);
    try {
      const conversation = await getConversation(id);
      setActiveId(id);
      setMessages(conversation.messages);
      setStreamingContent('');
      setToolActivity([]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load conversation.');
    }
  }, []);

  const startNewChat = React.useCallback((): void => {
    if (busyRef.current) {
      return;
    }
    setError(null);
    setActiveId(null);
    setMessages([]);
    setStreamingContent('');
    setToolActivity([]);
  }, []);

  const handleSend = React.useCallback(
    async (message: string): Promise<void> => {
      if (busyRef.current) {
        return;
      }
      busyRef.current = true;
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
      setToolActivity([]);

      try {
        const events = await streamChat(message, activeId ?? undefined);
        for await (const event of events) {
          if (event.type === 'start') {
            setActiveId(event.conversationId);
          } else if (event.type === 'tool_start') {
            setToolActivity((current) => [...current, { name: event.name, args: event.args }]);
          } else if (event.type === 'tool_result') {
            setToolActivity((current) => {
              const index = current.findLastIndex(
                (activity) => activity.name === event.name && activity.ok === undefined,
              );
              if (index === -1) {
                return current;
              }
              const next = [...current];
              next[index] = { ...next[index]!, ok: event.ok, output: event.output };
              return next;
            });
          } else if (event.type === 'delta') {
            setStreamingContent((current) => current + event.content);
          } else if (event.type === 'done') {
            setStreamingContent('');
            setToolActivity([]);
            setMessages((current) => [...current, event.message]);
            setStreaming(false);
            void loadConversations();
          } else if (event.type === 'error') {
            setStreamingContent('');
            setToolActivity([]);
            setStreaming(false);
            setError(event.message);
            void loadConversations();
          }
        }
      } catch (err) {
        setStreamingContent('');
        setToolActivity([]);
        setStreaming(false);
        if (err instanceof ApiError && err.status === 401) {
          await logout();
          router.replace('/login');
          return;
        }
        setError(err instanceof ApiError ? err.message : 'Failed to send message.');
      } finally {
        busyRef.current = false;
        setStreaming(false);
      }
    },
    [activeId, logout, router, loadConversations],
  );

  const handleRename = React.useCallback(
    async (id: string, title: string): Promise<void> => {
      await renameConversation(id, title);
      await loadConversations();
    },
    [loadConversations],
  );

  const handleDelete = React.useCallback(
    async (id: string): Promise<void> => {
      await deleteConversation(id);
      if (activeId === id) {
        setActiveId(null);
        setMessages([]);
      }
      await loadConversations();
    },
    [activeId, loadConversations],
  );

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
            {streaming && streamingContent.length === 0 && toolActivity.length > 0 && (
              <div className="space-y-2">
                {toolActivity.map((activity, index) => (
                  <ToolBubble key={`${activity.name}-${index}`} activity={activity} />
                ))}
              </div>
            )}
            {streaming && streamingContent.length === 0 && toolActivity.length === 0 && (
              <TypingIndicator />
            )}
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

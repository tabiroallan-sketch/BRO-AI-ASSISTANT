'use client';

import * as React from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Bot, ExternalLink, History, Loader2, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ChatInput } from '@/components/chat/chat-input';
import { MessageBubble } from '@/components/chat/message-bubble';
import { ToolBubble } from '@/components/chat/tool-bubble';
import { ModeSwitcher } from '@/components/mode-switcher';
import { OverlayResizeHandle } from '@/components/overlay/overlay-resize-handle';
import { VoiceOrb } from '@/components/overlay/voice-orb';
import { ApiError } from '@/lib/api';
import { useAiState } from '@/lib/ai-state';
import { useAuth } from '@/lib/auth';
import { streamChat, listConversations, getConversation } from '@/lib/chat';
import type { ChatMessage, Conversation, ToolActivity } from '@/lib/chat';
import { getDesktopApi } from '@/lib/desktop';
import { cn } from '@/lib/utils';

/**
 * The floating assistant (Stage 4). Rendered inside a transparent, frameless,
 * always-on-top Electron window over the `/overlay` route. Esc hides it,
 * streaming responses render inline, and the header is a drag region.
 */
export default function OverlayPage(): React.JSX.Element {
  const api = getDesktopApi();
  const { status } = useAuth();
  const reduceMotion = useReducedMotion();
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [streaming, setStreaming] = React.useState(false);
  const [streamingContent, setStreamingContent] = React.useState('');
  const [toolActivity, setToolActivity] = React.useState<ToolActivity[]>([]);
  const [history, setHistory] = React.useState<Conversation[] | null>(null);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const bottomRef = React.useRef<HTMLDivElement>(null);
  const busyRef = React.useRef(false);

  // The Electron window is transparent; make the document transparent too so
  // only the glass card is painted.
  React.useEffect(() => {
    const root = document.documentElement;
    const body = document.body;
    const previous = {
      htmlBg: root.style.background,
      bodyBg: body.style.background,
      bodyColor: body.style.backgroundColor,
    };
    root.style.background = 'transparent';
    body.style.background = 'transparent';
    body.style.backgroundColor = 'transparent';
    return () => {
      root.style.background = previous.htmlBg;
      body.style.background = previous.bodyBg;
      body.style.backgroundColor = previous.bodyColor;
    };
  }, []);

  // Esc hides the overlay (a second Esc closes the history panel first).
  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Escape') {
        return;
      }
      if (historyOpen) {
        setHistoryOpen(false);
        return;
      }
      api?.overlay.hide();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [api, historyOpen]);

  // Drive the voice orb from the shared listening engine (Stage 5): the
  // useVoice hook inside ChatInput keeps the experiential AI state in sync.
  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, streamingContent, toolActivity, streaming]);

  const openHistory = React.useCallback(async (): Promise<void> => {
    setHistoryOpen((open) => !open);
    if (!history) {
      try {
        setHistory(await listConversations());
      } catch {
        setHistory([]);
      }
    }
  }, [history]);

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
      setHistoryOpen(false);
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
    setHistoryOpen(false);
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
      useAiState.getState().setState('thinking');

      try {
        const events = await streamChat(message, activeId ?? undefined);
        for await (const event of events) {
          if (event.type === 'start') {
            setActiveId(event.conversationId);
          } else if (event.type === 'tool_start') {
            setToolActivity((current) => [...current, { name: event.name, args: event.args }]);
          } else if (event.type === 'tool_confirmation') {
            setToolActivity((current) => {
              const index = current.findLastIndex(
                (activity) => activity.name === event.name && activity.confirmationId === undefined,
              );
              if (index === -1) {
                return current;
              }
              const next = [...current];
              next[index] = {
                ...next[index]!,
                confirmationId: event.id,
                confirmationSummary: event.summary,
              };
              return next;
            });
          } else if (event.type === 'tool_result') {
            setToolActivity((current) => {
              const index = current.findLastIndex(
                (activity) => activity.name === event.name && activity.ok === undefined,
              );
              if (index === -1) {
                return current;
              }
              const next = [...current];
              next[index] = {
                ...next[index]!,
                ok: event.ok,
                output: event.output,
                connectProviderId: event.connectProviderId,
                connectLabel: event.connectLabel,
                permissionDenied: event.permissionDenied,
              };
              return next;
            });
          } else if (event.type === 'delta') {
            setStreamingContent((current) => current + event.content);
          } else if (event.type === 'done') {
            setStreamingContent('');
            setToolActivity((current) => current.filter((activity) => activity.confirmationId));
            setMessages((current) => [...current, event.message]);
            setStreaming(false);
            useAiState.getState().setState('idle');
          } else if (event.type === 'error') {
            setStreamingContent('');
            setToolActivity((current) => current.filter((activity) => activity.confirmationId));
            setStreaming(false);
            setError(event.message);
            useAiState.getState().setState('error');
          }
        }
      } catch (err) {
        setStreamingContent('');
        setToolActivity([]);
        setStreaming(false);
        setError(err instanceof ApiError ? err.message : 'Failed to send message.');
        useAiState.getState().setState('error');
      } finally {
        busyRef.current = false;
        setStreaming(false);
        useAiState.getState().setState('idle');
      }
    },
    [activeId],
  );

  function openInBro(): void {
    api?.window.show();
    api?.window.navigate('/chat');
    api?.overlay.hide();
  }

  if (status === 'loading') {
    return (
      <div className="flex h-dvh w-dvw items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-neon-cyan" />
      </div>
    );
  }

  if (status === 'unauthenticated') {
    return (
      <div className="flex h-dvh w-dvw items-center justify-center p-4">
        <div className="glass-overlay w-full max-w-xs rounded-2xl border p-5 text-center">
          <Bot className="mx-auto mb-3 h-8 w-8 text-neon-cyan" />
          <h2 className="text-sm font-semibold">Sign in to BRO</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            The overlay needs an active session. Open BRO to sign in.
          </p>
          <Button size="sm" className="mt-4 w-full" onClick={openInBro}>
            <ExternalLink className="mr-2 h-4 w-4" /> Open BRO
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-dvh w-dvw p-3">
      <div className="glass-overlay relative flex h-full w-full flex-col overflow-hidden rounded-2xl border shadow-2xl">
        <div
          className="flex items-center gap-2 border-b px-3 py-2"
          style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        >
          <VoiceOrb />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold leading-tight">BRO</p>
            <p className="truncate text-[11px] text-muted-foreground leading-tight">Overlay</p>
          </div>
          <div
            className="flex items-center gap-1"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            <ModeSwitcher compact />
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              onClick={() => void openHistory()}
              aria-label="Conversation history"
              title="History"
            >
              <History className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              onClick={openInBro}
              aria-label="Open in BRO"
              title="Open in BRO"
            >
              <ExternalLink className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              onClick={() => api?.overlay.hide()}
              aria-label="Hide overlay"
              title="Hide (Esc)"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="relative min-h-0 flex-1">
          <AnimatePresence>
            {historyOpen && (
              <motion.div
                initial={reduceMotion ? false : { opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.16 }}
                className="absolute inset-x-2 top-2 z-10 overflow-hidden rounded-xl border bg-background/95 shadow-xl backdrop-blur"
              >
                <div className="flex items-center justify-between border-b px-3 py-2">
                  <p className="text-xs font-semibold">Recent conversations</p>
                  <button
                    type="button"
                    className="text-[11px] text-neon-cyan hover:underline"
                    onClick={startNewChat}
                  >
                    New chat
                  </button>
                </div>
                <ul className="max-h-56 overflow-y-auto py-1">
                  {history === null && (
                    <li className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" /> Loading…
                    </li>
                  )}
                  {history !== null && history.length === 0 && (
                    <li className="px-3 py-2 text-xs text-muted-foreground">
                      No conversations yet.
                    </li>
                  )}
                  {history?.map((conversation) => (
                    <li key={conversation.id}>
                      <button
                        type="button"
                        className="w-full truncate px-3 py-2 text-left text-xs hover:bg-muted"
                        onClick={() => void selectConversation(conversation.id)}
                      >
                        {conversation.title ?? 'Untitled'}
                        <span className="ml-2 text-[10px] text-muted-foreground">
                          {new Date(conversation.updatedAt).toLocaleDateString()}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="h-full space-y-3 overflow-y-auto px-3 py-3">
            {messages.length === 0 && (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
                <motion.div
                  initial={reduceMotion ? false : { opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.3 }}
                  className="flex flex-col items-center gap-2"
                >
                  <div className="glass-chat flex h-12 w-12 items-center justify-center rounded-2xl">
                    <Sparkles className="h-5 w-5 text-neon-cyan" />
                  </div>
                  <p className="text-sm font-medium">Ask BRO anything</p>
                  <p className="max-w-[220px] text-xs text-muted-foreground">
                    Press Ctrl+Space to summon, Esc to hide.
                  </p>
                </motion.div>
              </div>
            )}
            {messages.map((entry) => (
              <MessageBubble key={entry.id} role={entry.role} content={entry.content} />
            ))}
            {streaming && toolActivity.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {toolActivity.map((activity, index) => (
                  <span
                    key={`${activity.name}-${index}`}
                    className={cn(
                      'rounded-full border px-2 py-0.5 text-[10px]',
                      activity.ok === false
                        ? 'border-destructive/40 text-destructive'
                        : 'border-border text-muted-foreground',
                    )}
                  >
                    {activity.ok === false ? '✕' : activity.ok === true ? '✓' : '…'} {activity.name}
                  </span>
                ))}
              </div>
            )}
            {streaming && streamingContent.length > 0 && (
              <MessageBubble role="ASSISTANT" content={streamingContent} streaming />
            )}
            {!streaming && toolActivity.some((activity) => activity.confirmationId) && (
              <div className="flex flex-col gap-1.5">
                {toolActivity
                  .filter((activity) => activity.confirmationId)
                  .map((activity, index) => (
                    <ToolBubble key={`${activity.name}-${index}`} activity={activity} />
                  ))}
              </div>
            )}
            {streaming && streamingContent.length === 0 && toolActivity.length === 0 && (
              <div className="glass-chat flex w-fit items-center gap-1 rounded-2xl px-4 py-3">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-neon-cyan" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-neon-cyan [animation-delay:120ms]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-neon-cyan [animation-delay:240ms]" />
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        </div>

        {error && <p className="border-t px-4 py-1.5 text-xs text-destructive">{error}</p>}

        <ChatInput disabled={streaming} autoFocus onSend={(message) => void handleSend(message)} />
        <OverlayResizeHandle />
      </div>
    </div>
  );
}

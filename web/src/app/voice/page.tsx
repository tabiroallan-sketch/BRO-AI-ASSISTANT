'use client';

import * as React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Mic, Radar, Square } from 'lucide-react';
import { ChatInput } from '@/components/chat/chat-input';
import { MessageBubble } from '@/components/chat/message-bubble';
import { ModeSwitcher } from '@/components/mode-switcher';
import { RequireAuth } from '@/components/require-auth';
import { VoiceOrb } from '@/components/overlay/voice-orb';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api';
import { useAiState } from '@/lib/ai-state';
import { streamChat } from '@/lib/chat';
import type { ChatMessage } from '@/lib/chat';
import { useVoice } from '@/hooks/use-voice';
import { getDesktopApi } from '@/lib/desktop';
import { initVoiceSettings } from '@/lib/voice/settings';
import { speak } from '@/lib/speech';
import { cn } from '@/lib/utils';

/**
 * The hands-free voice surface (Stage 12). Entered from the tray (or the
 * operating-mode switcher) with a single tap; the browser/desktop mic feeds
 * the shared listening + wake-word engines, and replies stream into the
 * transcript and are read aloud when TTS is enabled.
 */
export default function VoicePage(): React.JSX.Element {
  const voice = useVoice();
  const reduceMotion = useReducedMotion();
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [streaming, setStreaming] = React.useState(false);
  const [streamingContent, setStreamingContent] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [ttsEnabled, setTtsEnabled] = React.useState(false);
  const bottomRef = React.useRef<HTMLDivElement>(null);
  const busyRef = React.useRef(false);
  /** True while the hands-free loop is live: resume listening after each reply. */
  const resumeLoopRef = React.useRef(false);
  const resumeTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    void initVoiceSettings().then((settings) => {
      if (!cancelled) {
        setTtsEnabled(settings.ttsEnabled);
      }
    });
    return () => {
      cancelled = true;
      if (resumeTimerRef.current) {
        clearTimeout(resumeTimerRef.current);
      }
    };
  }, []);

  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, streamingContent, streaming]);

  const readAloud = React.useCallback(
    (content: string): void => {
      const finish = (): void => {
        if (resumeLoopRef.current && voice.state.mode !== 'off') {
          resumeLoopRef.current = false;
          useAiState.getState().setState('idle');
          // Brief pause so the TTS tail isn't transcribed as a new utterance,
          // then resume listening to keep the conversation going hands-free.
          resumeTimerRef.current = setTimeout(() => {
            resumeTimerRef.current = null;
            if (!voice.isListening && !busyRef.current) {
              void voice.startManual();
            }
          }, 450);
          return;
        }
        useAiState.getState().setState('idle');
      };

      if (!ttsEnabled) {
        finish();
        return;
      }
      useAiState.getState().setState('speaking');
      void initVoiceSettings().then((settings) => {
        const ok = speak(content, {
          voice: settings.ttsVoice,
          rate: settings.ttsRate,
          pitch: settings.ttsPitch,
          onEnd: finish,
        });
        if (!ok) {
          finish();
        }
      });
    },
    [ttsEnabled, voice],
  );

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
      useAiState.getState().setState('thinking');

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
            readAloud(event.message.content);
          } else if (event.type === 'error') {
            setStreamingContent('');
            setStreaming(false);
            setError(event.message);
            useAiState.getState().setState('error');
          }
        }
      } catch (err) {
        setStreamingContent('');
        setStreaming(false);
        setError(err instanceof ApiError ? err.message : 'Failed to send message.');
        useAiState.getState().setState('error');
      } finally {
        busyRef.current = false;
        setStreaming(false);
        // Only reset thinking -> idle; readAloud owns speaking/error terminal states.
        if (useAiState.getState().state === 'thinking') {
          useAiState.getState().setState('idle');
        }
      }
    },
    [activeId, readAloud],
  );

  const api = getDesktopApi();
  const listening = voice.isListening;
  const voiceReady = voice.state.sttSupported && voice.state.micSupported;
  const interim = voice.state.interim;
  const hint = listening
    ? interim
      ? interim
      : 'Listening — speak now'
    : voice.state.mode === 'off'
      ? 'Voice input is off — enable it in Settings › Voice.'
      : 'Tap the mic (or use the shortcut) to talk hands-free';

  const wake = voice.wake;
  let wakeStatus: string | null = null;
  if (voice.state.mode !== 'off' && wake.supported) {
    if (!wake.enabled) {
      wakeStatus = 'Wake word off';
    } else if (voice.wakeOwner) {
      wakeStatus =
        wake.phase === 'armed'
          ? 'Wake word armed'
          : wake.phase === 'hearing'
            ? 'Hearing…'
            : wake.phase === 'triggered'
              ? 'Wake word heard'
              : 'Wake word paused';
    } else {
      wakeStatus = 'Wake word paused (another window)';
    }
  }

  return (
    <RequireAuth>
      <div className="flex min-h-dvh flex-col">
        <header className="glass-strong sticky top-0 z-40">
          <div className="mx-auto flex h-14 w-full max-w-[90rem] items-center gap-3 px-4">
            <VoiceOrb />
            <div className="min-w-0">
              <p className="text-sm font-semibold tracking-[0.2em] text-foreground">BRO · VOICE</p>
              <p className="text-xs text-muted-foreground">Hands-free mode</p>
            </div>
            <div className="ml-auto flex items-center gap-2">
              {wakeStatus && (
                <span
                  className={cn(
                    'hidden items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[11px] sm:flex',
                    wake.enabled && voice.wakeOwner
                      ? 'border-neon-cyan/40 text-neon-cyan'
                      : 'border-border text-muted-foreground',
                  )}
                >
                  <Radar className="h-3 w-3" />
                  {wakeStatus}
                </span>
              )}
              <ModeSwitcher />
            </div>
          </div>
        </header>

        <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center gap-8 px-4 py-8">
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.4 }}
            className="relative flex flex-col items-center gap-4"
          >
            <VoiceOrb size="lg" />
            <Button
              type="button"
              size="icon"
              variant={listening ? 'destructive' : 'secondary'}
              className={cn(
                'absolute -bottom-2 left-1/2 h-12 w-12 -translate-x-1/2 translate-y-full rounded-full',
                listening &&
                  'glow-danger shadow-[0_0_18px_color-mix(in_oklab,var(--destructive)_40%,transparent)]',
              )}
              disabled={!voiceReady || voice.state.mode === 'off'}
              onClick={() => {
                if (listening) {
                  resumeLoopRef.current = false;
                  voice.stop();
                } else {
                  resumeLoopRef.current = true;
                  void voice.startManual();
                }
              }}
              aria-label={listening ? 'Stop listening' : 'Start listening'}
              title={voice.state.error ?? undefined}
            >
              {listening ? <Square className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
            </Button>
          </motion.div>

          <div className="flex h-8 items-center justify-center text-center">
            <p
              className={cn('text-sm', listening ? 'text-neon-cyan' : 'text-muted-foreground')}
              role="status"
            >
              {hint}
            </p>
          </div>

          {(messages.length > 0 || streaming || error) && (
            <section className="w-full space-y-3 overflow-y-auto rounded-2xl border border-white/10 bg-foreground/5 p-4 backdrop-blur">
              {messages.map((entry) => (
                <MessageBubble key={entry.id} role={entry.role} content={entry.content} />
              ))}
              {streaming && streamingContent.length > 0 && (
                <MessageBubble role="ASSISTANT" content={streamingContent} streaming />
              )}
              {streaming && streamingContent.length === 0 && (
                <div className="flex w-fit items-center gap-1 rounded-2xl border border-white/10 bg-background/80 px-4 py-3">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-neon-cyan" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-neon-cyan [animation-delay:120ms]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-neon-cyan [animation-delay:240ms]" />
                </div>
              )}
              {error && <p className="text-xs text-destructive">{error}</p>}
              <div ref={bottomRef} />
            </section>
          )}
        </main>

        <div className="mx-auto w-full max-w-3xl px-4 pb-6">
          <ChatInput
            disabled={streaming}
            onSend={(message) => void handleSend(message)}
            autoSend
            onVoiceTranscript={() => {
              resumeLoopRef.current = true;
            }}
            autoFocus={!api}
          />
        </div>
      </div>
    </RequireAuth>
  );
}

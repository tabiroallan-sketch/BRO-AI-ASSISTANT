'use client';

import * as React from 'react';
import { Mic, Send, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useVoice } from '@/hooks/use-voice';
import { cn } from '@/lib/utils';

export function ChatInput({
  disabled,
  onSend,
  autoFocus,
  autoSend = false,
  onVoiceTranscript,
}: {
  disabled: boolean;
  onSend: (message: string) => void;
  autoFocus?: boolean;
  /** Auto-send finalized transcripts (hands-free) instead of filling the draft. */
  autoSend?: boolean;
  /** Called when a finalized transcript is sent via the auto-send path. */
  onVoiceTranscript?: (text: string) => void;
}): React.JSX.Element {
  const [value, setValue] = React.useState('');
  const voice = useVoice();
  const { state } = voice;

  // Manual transcripts append to the draft; push-to-talk results send directly.
  // In autoSend mode every finalized transcript sends (hands-free).
  React.useEffect(() => {
    const consumed = voice.engine.consumeTranscript();
    if (!consumed) {
      return;
    }
    if (consumed.source === 'ptt' || autoSend) {
      onVoiceTranscript?.(consumed.text);
      onSend(consumed.text);
      return;
    }
    setValue((current) => {
      const base = current.trim();
      return base ? `${base} ${consumed.text}` : consumed.text;
    });
  }, [voice, state.transcriptId, onSend, autoSend, onVoiceTranscript]);

  function submit(): void {
    const trimmed = value.trim();
    if (!trimmed || disabled) {
      return;
    }
    onSend(trimmed);
    setValue('');
  }

  const voiceEnabled = state.sttSupported && state.micSupported && state.mode !== 'off';
  const displayed = state.interim ? `${value}${value ? ' ' : ''}${state.interim}` : value;
  const canSend = !disabled && value.trim().length > 0;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className="flex items-end gap-2 border-t bg-background/60 p-4 backdrop-blur-md"
    >
      <Textarea
        value={displayed}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            submit();
          }
        }}
        placeholder={voice.isListening ? 'Listening…' : 'Message BRO…'}
        rows={1}
        className="max-h-40 min-h-[44px] resize-none"
        aria-label="Message BRO"
        autoFocus={autoFocus}
      />
      {voiceEnabled && (
        <Button
          type="button"
          size="icon"
          variant={voice.isListening ? 'destructive' : 'secondary'}
          className={cn(
            'relative h-11 w-11 shrink-0',
            voice.isListening &&
              'glow-danger shadow-[0_0_18px_color-mix(in_oklab,var(--destructive)_40%,transparent)]',
          )}
          disabled={disabled}
          onClick={() => (voice.isListening ? voice.stop() : voice.startManual())}
          aria-label={voice.isListening ? 'Stop voice input' : 'Start voice input'}
          title={state.error ?? undefined}
        >
          {voice.isListening && (
            <span
              className="absolute inline-flex h-full w-full animate-pulse-ring rounded-md border-2 border-destructive/50"
              style={{ opacity: 0.5 + 0.5 * state.level }}
            />
          )}
          {voice.isListening ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
        </Button>
      )}
      {state.error && !voice.isListening && (
        <span className="sr-only" role="alert">
          {state.error}
        </span>
      )}
      <Button
        type="submit"
        size="icon"
        className={cn('h-11 w-11 shrink-0', canSend && 'glow-primary')}
        disabled={!canSend}
        aria-label="Send message"
      >
        <Send className="h-4 w-4" />
      </Button>
    </form>
  );
}

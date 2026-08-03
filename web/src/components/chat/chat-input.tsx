'use client';

import * as React from 'react';
import { Mic, Send, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  createSpeechRecognizer,
  isSpeechRecognitionSupported,
  type SpeechRecognizer,
} from '@/lib/speech';

export function ChatInput({
  disabled,
  onSend,
}: {
  disabled: boolean;
  onSend: (message: string) => void;
}): React.JSX.Element {
  const [value, setValue] = React.useState('');
  const [listening, setListening] = React.useState(false);
  const [interim, setInterim] = React.useState('');
  const recognizerRef = React.useRef<SpeechRecognizer | null>(null);
  const speechSupported = isSpeechRecognitionSupported();

  React.useEffect(() => {
    return () => {
      recognizerRef.current?.stop();
    };
  }, []);

  function submit(): void {
    const trimmed = value.trim();
    if (!trimmed || disabled) {
      return;
    }
    onSend(trimmed);
    setValue('');
    setInterim('');
  }

  function stopListening(): void {
    recognizerRef.current?.stop();
    setListening(false);
    setInterim('');
  }

  function toggleListening(): void {
    if (disabled) {
      return;
    }
    if (recognizerRef.current?.isListening()) {
      stopListening();
      return;
    }
    const recognizer = createSpeechRecognizer({
      onInterim: (text) => setInterim(text),
      onFinal: (text) => {
        setValue((current) => {
          const base = current.trim();
          return base ? `${base} ${text}` : text;
        });
      },
      onEnd: () => {
        setListening(false);
        setInterim('');
      },
      onError: () => {
        setListening(false);
        setInterim('');
      },
    });
    if (!recognizer) {
      return;
    }
    recognizerRef.current = recognizer;
    recognizer.start();
    setListening(true);
  }

  const displayed = interim ? `${value}${value ? ' ' : ''}${interim}` : value;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className="flex items-end gap-2 border-t bg-background p-4"
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
        placeholder={listening ? 'Listening…' : 'Message BRO…'}
        rows={1}
        className="max-h-40 min-h-[44px] resize-none"
        aria-label="Message BRO"
      />
      {speechSupported && (
        <Button
          type="button"
          size="icon"
          variant={listening ? 'destructive' : 'secondary'}
          className="h-11 w-11 shrink-0"
          disabled={disabled}
          onClick={toggleListening}
          aria-label={listening ? 'Stop voice input' : 'Start voice input'}
        >
          {listening ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
        </Button>
      )}
      <Button
        type="submit"
        size="icon"
        className="h-11 w-11 shrink-0"
        disabled={disabled || value.trim().length === 0}
        aria-label="Send message"
      >
        <Send className="h-4 w-4" />
      </Button>
    </form>
  );
}

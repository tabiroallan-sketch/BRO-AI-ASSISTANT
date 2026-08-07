'use client';

import * as React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Bot, User, Volume2, VolumeX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { MessageRole } from '@/lib/chat';
import { speak, stopSpeaking } from '@/lib/speech';
import { cn } from '@/lib/utils';
import { Markdown } from '@/components/chat/markdown';

export function MessageBubble({
  role,
  content,
  streaming,
  suggestions,
  onSuggestionClick,
}: {
  role: MessageRole;
  content: string;
  streaming?: boolean;
  suggestions?: string[];
  onSuggestionClick?: (suggestion: string) => void;
}): React.JSX.Element {
  const isUser = role === 'USER';
  const [speaking, setSpeaking] = React.useState(false);
  const reduceMotion = useReducedMotion();

  React.useEffect(() => {
    return () => {
      if (speaking) {
        stopSpeaking();
      }
    };
  }, [speaking]);

  function toggleSpeak(): void {
    if (speaking) {
      stopSpeaking();
      setSpeaking(false);
      return;
    }
    if (speak(content, () => setSpeaking(false))) {
      setSpeaking(true);
    }
  }

  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 10, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 320, damping: 28 }}
      className={cn('flex w-full gap-3', isUser ? 'justify-end' : 'justify-start')}
    >
      {!isUser && (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border bg-muted">
          <Bot className="h-4 w-4" />
        </div>
      )}
      <div
        className={cn(
          'max-w-[80%] rounded-2xl px-4 py-3',
          isUser ? 'bg-primary text-primary-foreground' : 'border bg-card text-card-foreground',
          streaming &&
            !isUser &&
            'shadow-[0_0_24px_-8px] shadow-neon-cyan/40 transition-shadow duration-500',
        )}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{content}</p>
        ) : (
          <Markdown content={content} />
        )}
        {suggestions && suggestions.length > 0 && !streaming && (
          <div className="mt-3 flex flex-wrap gap-2">
            {suggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => onSuggestionClick?.(suggestion)}
                className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-neon-cyan/60 hover:text-foreground"
              >
                {suggestion}
              </button>
            ))}
          </div>
        )}
        {streaming && <span className="ml-0.5 inline-block h-3 w-0.5 animate-pulse bg-current" />}
      </div>
      {isUser && (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border bg-primary">
          <User className="h-4 w-4 text-primary-foreground" />
        </div>
      )}
      {!isUser && !streaming && (
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className={cn('h-8 w-8 self-center shrink-0', speaking && 'text-primary')}
          onClick={toggleSpeak}
          aria-label={speaking ? 'Stop reading aloud' : 'Read aloud'}
        >
          {speaking ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
        </Button>
      )}
    </motion.div>
  );
}

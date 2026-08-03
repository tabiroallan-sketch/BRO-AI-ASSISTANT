'use client';

import * as React from 'react';
import { Bot, User } from 'lucide-react';
import type { MessageRole } from '@/lib/chat';
import { cn } from '@/lib/utils';
import { Markdown } from '@/components/chat/markdown';

export function MessageBubble({
  role,
  content,
  streaming,
}: {
  role: MessageRole;
  content: string;
  streaming?: boolean;
}): React.JSX.Element {
  const isUser = role === 'USER';

  return (
    <div className={cn('flex w-full gap-3', isUser ? 'justify-end' : 'justify-start')}>
      {!isUser && (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border bg-muted">
          <Bot className="h-4 w-4" />
        </div>
      )}
      <div
        className={cn(
          'max-w-[80%] rounded-2xl px-4 py-3',
          isUser ? 'bg-primary text-primary-foreground' : 'border bg-card text-card-foreground',
        )}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{content}</p>
        ) : (
          <Markdown content={content} />
        )}
        {streaming && <span className="ml-0.5 inline-block h-3 w-0.5 animate-pulse bg-current" />}
      </div>
      {isUser && (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border bg-primary">
          <User className="h-4 w-4 text-primary-foreground" />
        </div>
      )}
    </div>
  );
}

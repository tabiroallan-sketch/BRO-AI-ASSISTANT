'use client';

import * as React from 'react';
import { Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

export function ChatInput({
  disabled,
  onSend,
}: {
  disabled: boolean;
  onSend: (message: string) => void;
}): React.JSX.Element {
  const [value, setValue] = React.useState('');

  function submit(): void {
    const trimmed = value.trim();
    if (!trimmed || disabled) {
      return;
    }
    onSend(trimmed);
    setValue('');
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className="flex items-end gap-2 border-t bg-background p-4"
    >
      <Textarea
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            submit();
          }
        }}
        placeholder="Message BRO…"
        rows={1}
        className="max-h-40 min-h-[44px] resize-none"
        aria-label="Message BRO"
      />
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

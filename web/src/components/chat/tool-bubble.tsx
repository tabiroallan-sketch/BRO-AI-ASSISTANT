'use client';

import * as React from 'react';
import { CheckCircle2, Loader2, Wrench, XCircle } from 'lucide-react';
import type { ToolActivity } from '@/lib/chat';
import { cn } from '@/lib/utils';

export function ToolBubble({ activity }: { activity: ToolActivity }): React.JSX.Element {
  const running = activity.ok === undefined;

  return (
    <div className="flex w-full gap-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border bg-muted">
        <Wrench className="h-4 w-4" />
      </div>
      <div className="max-w-[80%] rounded-2xl border bg-card px-4 py-3 text-card-foreground">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium">{activity.name}</span>
          <span
            className={cn(
              'inline-flex items-center gap-1 text-xs',
              running
                ? 'text-muted-foreground'
                : activity.ok
                  ? 'text-muted-foreground'
                  : 'text-destructive',
            )}
          >
            {running ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" />
                running…
              </>
            ) : activity.ok ? (
              <>
                <CheckCircle2 className="h-3 w-3 text-primary" />
                done
              </>
            ) : (
              <>
                <XCircle className="h-3 w-3" />
                failed
              </>
            )}
          </span>
        </div>
        <code className="mt-1 block max-h-28 overflow-auto whitespace-pre-wrap break-all text-xs text-muted-foreground">
          {JSON.stringify(activity.args)}
        </code>
        {!running && activity.ok && activity.output !== '' && (
          <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">
            {activity.output}
          </p>
        )}
      </div>
    </div>
  );
}

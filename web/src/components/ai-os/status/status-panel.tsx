'use client';

import { AlertTriangle, CheckCircle2, CircleDashed, XCircle } from 'lucide-react';
import { formatStatusTime, useStatusFeed, type StatusLevel } from '@/lib/status-feed';
import { cn } from '@/lib/utils';

const LEVEL_ICONS: Record<StatusLevel, typeof CircleDashed> = {
  info: CircleDashed,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: XCircle,
};

const LEVEL_TONES: Record<StatusLevel, string> = {
  info: 'text-neon-cyan',
  success: 'text-emerald-400',
  warning: 'text-amber-400',
  error: 'text-red-400',
};

/** Persistent event feed for the status floating panel. */
export function StatusPanelContent(): React.JSX.Element {
  const events = useStatusFeed((state) => state.events);
  const unread = useStatusFeed((state) => state.unread);
  const markRead = useStatusFeed((state) => state.markRead);

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          Event log
        </span>
        {unread > 0 && (
          <button
            type="button"
            onClick={markRead}
            className="rounded-full border border-neon-cyan/40 bg-neon-cyan/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-neon-cyan transition-colors hover:bg-neon-cyan/20"
          >
            {unread} new · clear
          </button>
        )}
      </div>
      {events.length === 0 ? (
        <p className="py-4 text-center font-mono text-[11px] text-muted-foreground">
          No status events yet.
        </p>
      ) : (
        <ul className="max-h-60 space-y-2 overflow-y-auto pr-1">
          {events.map((event) => {
            const Icon = LEVEL_ICONS[event.level];
            return (
              <li key={event.id} className="flex items-start gap-2">
                <Icon className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', LEVEL_TONES[event.level])} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-xs font-medium text-foreground">
                      {event.title}
                    </span>
                    <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                      {formatStatusTime(event.createdAt)}
                    </span>
                  </div>
                  {event.detail && (
                    <div className="truncate font-mono text-[10px] text-muted-foreground">
                      {event.detail}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

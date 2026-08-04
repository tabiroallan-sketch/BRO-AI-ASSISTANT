'use client';

import * as React from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { AlertTriangle, CheckCircle2, CircleDashed, X, XCircle } from 'lucide-react';
import { useStatusFeed, type StatusEvent, type StatusLevel } from '@/lib/status-feed';
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

/** Dismiss timing in ms per severity. */
const LEVEL_TTL: Record<StatusLevel, number> = {
  info: 4500,
  success: 4500,
  warning: 6000,
  error: 8000,
};

/**
 * Transient toasts for the status system: new feed events slide in from the
 * bottom-right and auto-dismiss. Uses the feed store imperatively so pushes
 * from anywhere in the app surface immediately.
 */
export function StatusToaster(): React.JSX.Element {
  const events = useStatusFeed((state) => state.events);
  const reduceMotion = useReducedMotion();
  const toasted = React.useRef(new Set<string>());
  const [visible, setVisible] = React.useState<StatusEvent[]>([]);

  React.useEffect(() => {
    const newcomers = events.filter((event) => !toasted.current.has(event.id));
    if (newcomers.length === 0) {
      return;
    }
    newcomers.forEach((event) => toasted.current.add(event.id));
    setVisible((current) => [...newcomers, ...current]);
    newcomers.forEach((event) => {
      window.setTimeout(() => {
        useStatusFeed.getState().dismiss(event.id);
        setVisible((current) => current.filter((item) => item.id !== event.id));
      }, LEVEL_TTL[event.level]);
    });
  }, [events]);

  const close = (event: StatusEvent): void => {
    useStatusFeed.getState().dismiss(event.id);
    setVisible((current) => current.filter((item) => item.id !== event.id));
  };

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-40 flex w-80 flex-col gap-2">
      <AnimatePresence initial={false}>
        {visible.map((event) => {
          const Icon = LEVEL_ICONS[event.level];
          return (
            <motion.div
              key={event.id}
              layout
              initial={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 24, scale: 0.97 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 24, scale: 0.97 }}
              transition={{ type: 'spring', stiffness: 380, damping: 30 }}
              className="pointer-events-auto flex items-start gap-3 rounded-xl border border-white/10 bg-background/70 p-3 shadow-[0_0_24px_color-mix(in_oklab,var(--neon-cyan)_15%,transparent)] backdrop-blur-xl"
              role="status"
            >
              <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', LEVEL_TONES[event.level])} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-foreground">{event.title}</div>
                {event.detail && (
                  <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                    {event.detail}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => close(event)}
                aria-label="Dismiss status message"
                className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

'use client';

import * as React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { CheckCircle2, Loader2, PlugZap, Wrench, XCircle } from 'lucide-react';
import type { ToolActivity } from '@/lib/chat';
import { getIntegrationConnectUrl } from '@/lib/integrations';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

export function ToolBubble({ activity }: { activity: ToolActivity }): React.JSX.Element {
  const running = activity.ok === undefined;
  const needsConnect = activity.connectProviderId !== undefined;
  const [connecting, setConnecting] = React.useState(false);
  const [connectError, setConnectError] = React.useState<string | null>(null);
  const reduceMotion = useReducedMotion();

  async function handleConnect(): Promise<void> {
    const provider = activity.connectProviderId;
    if (!provider || connecting) {
      return;
    }
    setConnecting(true);
    setConnectError(null);
    try {
      const url = await getIntegrationConnectUrl(provider);
      window.location.href = url;
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : 'Could not start the connection.');
      setConnecting(false);
    }
  }

  return (
    <motion.div
      layout={reduceMotion ? false : true}
      initial={reduceMotion ? false : { opacity: 0, y: 10, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 6, scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 320, damping: 28 }}
      className={cn('flex w-full gap-3', running && 'relative')}
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border bg-muted">
        <Wrench className="h-4 w-4" />
      </div>
      <div
        className={cn(
          'max-w-[80%] rounded-2xl border bg-card px-4 py-3 text-card-foreground transition-shadow duration-300',
          running && 'glow-primary-soft',
        )}
      >
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium">{activity.name}</span>
          <span
            className={cn(
              'inline-flex items-center gap-1 text-xs',
              running
                ? 'text-neon-cyan'
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
        {needsConnect && (
          <div className="mt-3 space-y-2">
            <p className="whitespace-pre-wrap text-xs text-muted-foreground">{activity.output}</p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void handleConnect()}
              disabled={connecting}
            >
              {connecting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <PlugZap className="h-3.5 w-3.5" />
              )}
              {connecting
                ? 'Starting…'
                : `Connect ${activity.connectLabel ?? activity.connectProviderId}`}
            </Button>
            {connectError && <p className="text-xs text-destructive">{connectError}</p>}
          </div>
        )}
      </div>
    </motion.div>
  );
}

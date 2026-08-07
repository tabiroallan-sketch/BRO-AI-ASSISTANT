'use client';

import * as React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { CheckCircle2, Loader2, PlugZap, ShieldQuestion, Wrench, XCircle } from 'lucide-react';
import type { ToolActivity } from '@/lib/chat';
import { getIntegrationConnectUrl } from '@/lib/integrations';
import { decideAction } from '@/lib/computer';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

export function ToolBubble({ activity }: { activity: ToolActivity }): React.JSX.Element {
  const running = activity.ok === undefined;
  const needsConnect = activity.connectProviderId !== undefined;
  const needsConfirmation = activity.confirmationId !== undefined;
  const [connecting, setConnecting] = React.useState(false);
  const [connectError, setConnectError] = React.useState<string | null>(null);
  const [deciding, setDeciding] = React.useState<'approve' | 'reject' | null>(null);
  const [decideError, setDecideError] = React.useState<string | null>(null);
  const [decidedResult, setDecidedResult] = React.useState<string | null>(null);
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

  async function handleDecide(decision: 'approve' | 'reject'): Promise<void> {
    const id = activity.confirmationId;
    if (!id || deciding) {
      return;
    }
    setDeciding(decision);
    setDecideError(null);
    try {
      const action = await decideAction(id, decision);
      setDecidedResult(action.result ?? (decision === 'approve' ? 'Approved.' : 'Rejected.'));
    } catch (err) {
      setDecideError(err instanceof Error ? err.message : 'Could not send your decision.');
    } finally {
      setDeciding(null);
    }
  }

  const confirmText =
    activity.confirmationSummary ??
    `This action ${activity.name} needs your approval before it can run.`;

  return (
    <motion.div
      layout={reduceMotion ? false : true}
      initial={reduceMotion ? false : { opacity: 0, y: 10, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 6, scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 320, damping: 28 }}
      className={cn('flex w-full gap-3', (running || needsConfirmation) && 'relative')}
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
        {needsConfirmation && !decidedResult && (
          <div className="mt-3 space-y-2">
            <p className="flex items-start gap-2 whitespace-pre-wrap text-xs text-muted-foreground">
              <ShieldQuestion className="mt-0.5 h-3.5 w-3.5 shrink-0 text-neon-cyan" />
              {confirmText}
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void handleDecide('approve')}
                disabled={deciding !== null}
              >
                {deciding === 'approve' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                )}
                Approve
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => void handleDecide('reject')}
                disabled={deciding !== null}
              >
                {deciding === 'reject' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <XCircle className="h-3.5 w-3.5" />
                )}
                Reject
              </Button>
            </div>
          </div>
        )}
        {decidedResult && (
          <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{decidedResult}</p>
        )}
        {decideError && <p className="mt-2 text-xs text-destructive">{decideError}</p>}
        {!needsConfirmation && !running && activity.ok && activity.output !== '' && (
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

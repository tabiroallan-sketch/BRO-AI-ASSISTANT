'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Check,
  CheckCircle2,
  Loader2,
  Monitor,
  RefreshCw,
  ShieldCheck,
  ShieldQuestion,
  Trash2,
  XCircle,
} from 'lucide-react';
import { DashboardPageHeader } from '@/components/dashboard-page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  decideAction,
  listSystemActions,
  type PendingAction,
  type SystemToolInfo,
} from '@/lib/computer';
import { cn } from '@/lib/utils';

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString();
}

function StatusBadge({ status }: { status: PendingAction['status'] }): React.JSX.Element {
  if (status === 'approved') {
    return (
      <Badge variant="default" className="gap-1">
        <CheckCircle2 className="h-3 w-3" />
        Approved
      </Badge>
    );
  }
  if (status === 'rejected') {
    return (
      <Badge variant="destructive" className="gap-1">
        <XCircle className="h-3 w-3" />
        Rejected
      </Badge>
    );
  }
  if (status === 'expired') {
    return (
      <Badge variant="outline" className="gap-1">
        Expired
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="gap-1">
      <ShieldQuestion className="h-3 w-3" />
      Pending approval
    </Badge>
  );
}

export default function SystemPage(): React.JSX.Element {
  const router = useRouter();
  const { logout } = useAuth();
  const [data, setData] = React.useState<{
    actions: PendingAction[];
    tools: SystemToolInfo[];
  } | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [decidingId, setDecidingId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function load(): Promise<void> {
    setError(null);
    try {
      setData(await listSystemActions());
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        await logout();
        router.replace('/login');
        return;
      }
      setError('Failed to load computer actions.');
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleDecision(
    action: PendingAction,
    decision: 'approve' | 'reject',
  ): Promise<void> {
    if (decidingId) {
      return;
    }
    setDecidingId(action.id);
    setError(null);
    try {
      const updated = await decideAction(action.id, decision);
      setData((current) =>
        current
          ? {
              ...current,
              actions: current.actions.map((entry) => (entry.id === updated.id ? updated : entry)),
            }
          : current,
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send your decision.');
    } finally {
      setDecidingId(null);
    }
  }

  const pendingCount = data?.actions.filter((action) => action.status === 'pending').length ?? 0;

  return (
    <div>
      <DashboardPageHeader
        title="Computer control"
        description="Actions BRO wants to take on your computer. Destructive operations wait here for your explicit approval."
      />

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      {data === null && loading ? (
        <div className="flex min-h-[30vh] items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-8">
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <ShieldQuestion className="h-4 w-4 text-neon-cyan" />
                Pending actions
                {pendingCount > 0 && <Badge variant="secondary">{pendingCount} waiting</Badge>}
              </h2>
              <Button type="button" variant="ghost" size="sm" onClick={() => void load()}>
                <RefreshCw className="h-3.5 w-3.5" />
                Refresh
              </Button>
            </div>
            {data === null || data.actions.length === 0 ? (
              <Card>
                <CardContent className="p-6 text-center text-sm text-muted-foreground">
                  No computer actions right now.
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {data.actions.map((action) => {
                  const deciding = decidingId === action.id;
                  const pending = action.status === 'pending';
                  return (
                    <Card key={action.id}>
                      <CardContent className="space-y-2 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <Monitor className="h-4 w-4 shrink-0 text-primary" />
                            <span className="font-mono text-sm font-medium">{action.toolName}</span>
                          </div>
                          <StatusBadge status={action.status} />
                        </div>
                        <p className="whitespace-pre-wrap text-sm">{action.summary}</p>
                        <code className="block max-h-28 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-muted/60 p-2 text-xs text-muted-foreground">
                          {JSON.stringify(action.args, null, 2)}
                        </code>
                        {action.result && (
                          <p className="whitespace-pre-wrap text-xs text-muted-foreground">
                            {action.result}
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground">
                          Requested {formatWhen(action.createdAt)} · expires{' '}
                          {formatWhen(action.expiresAt)}
                        </p>
                        {pending && (
                          <div className="flex gap-2 pt-1">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={deciding}
                              onClick={() => void handleDecision(action, 'approve')}
                            >
                              {deciding ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Check className="h-3.5 w-3.5" />
                              )}
                              Approve
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              disabled={deciding}
                              onClick={() => void handleDecision(action, 'reject')}
                            >
                              <XCircle className="h-3.5 w-3.5" />
                              Reject
                            </Button>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </section>

          <section>
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <ShieldCheck className="h-4 w-4 text-neon-cyan" />
              Computer capabilities
            </h2>
            {data === null ? (
              <p className="text-sm text-muted-foreground">No tools available.</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {data.tools.map((tool) => (
                  <Card key={tool.name}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-2">
                        <p className="break-all font-mono text-sm font-medium">{tool.name}</p>
                        <Badge
                          variant={tool.requireConfirmation ? 'secondary' : 'outline'}
                          className={cn('shrink-0 gap-1')}
                        >
                          {tool.requireConfirmation ? (
                            <>
                              <ShieldQuestion className="h-3 w-3" />
                              Confirmation
                            </>
                          ) : (
                            <>
                              <Trash2 className="h-3 w-3" />
                              Direct
                            </>
                          )}
                        </Badge>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">{tool.description}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

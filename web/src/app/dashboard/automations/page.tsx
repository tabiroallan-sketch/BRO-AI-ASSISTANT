'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertCircle, Loader2, ShieldAlert } from 'lucide-react';
import { DashboardPageHeader } from '@/components/dashboard-page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  getAutomations,
  type AutomationsResponse,
  type ExecutionSummary,
  type WorkflowSummary,
} from '@/lib/dashboard';

function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (['success', 'finished'].includes(status)) {
    return 'default';
  }
  if (['error', 'crashed', 'canceled', 'cancelled'].includes(status)) {
    return 'destructive';
  }
  return 'outline';
}

function formatDate(value: string | null): string {
  if (!value) {
    return '—';
  }
  return new Date(value).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function WorkflowsCard({ workflows }: { workflows: WorkflowSummary[] }): React.JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Workflows</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {workflows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No workflows found.</p>
        ) : (
          workflows.map((workflow) => (
            <div
              key={workflow.id}
              className="flex items-center justify-between gap-4 rounded-lg border p-3"
            >
              <p className="truncate font-medium">{workflow.name}</p>
              {workflow.active ? (
                <Badge>Active</Badge>
              ) : (
                <Badge variant="secondary">Inactive</Badge>
              )}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function ExecutionsCard({ executions }: { executions: ExecutionSummary[] }): React.JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Recent executions</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {executions.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No executions yet.</p>
        ) : (
          executions.map((execution) => (
            <div
              key={execution.id}
              className="flex items-center justify-between gap-4 rounded-lg border p-3"
            >
              <div className="min-w-0">
                <p className="truncate font-medium">
                  {execution.workflowName || 'Untitled workflow'}
                </p>
                <p className="text-xs text-muted-foreground">{formatDate(execution.startedAt)}</p>
              </div>
              <Badge variant={statusVariant(execution.status)}>{execution.status}</Badge>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

export default function AutomationsPage(): React.JSX.Element {
  const router = useRouter();
  const { user, logout } = useAuth();
  const [data, setData] = React.useState<AutomationsResponse | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function load(): Promise<void> {
    try {
      setData(await getAutomations());
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        await logout();
        router.replace('/login');
        return;
      }
      setError('Failed to load automation status.');
    }
  }

  React.useEffect(() => {
    if (user?.role !== 'ADMIN') {
      return;
    }
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.role]);

  if (user === null || user.role !== 'ADMIN') {
    return (
      <div>
        <DashboardPageHeader title="Automations" />
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-12 text-center">
            <ShieldAlert className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              You do not have permission to view this page.
            </p>
            <Button variant="outline" size="sm" asChild>
              <Link href="/dashboard">Back to dashboard</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (data === null) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div>
      <DashboardPageHeader
        title="Automations"
        description="Status of n8n workflows BRO can trigger and monitor."
      />

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      {!data.enabled ? (
        <Card>
          <CardContent className="flex flex-col items-start gap-3 py-10">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-muted-foreground" />
              <p className="font-medium">n8n is not configured</p>
            </div>
            <p className="text-sm text-muted-foreground">
              {data.error ??
                'Set N8N_BASE_URL and N8N_API_KEY in your .env file to enable the automation tools.'}
            </p>
            <Button asChild variant="outline" size="sm">
              <Link href="/settings">Open settings</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {data.error && (
            <Card>
              <CardContent className="flex items-center gap-2 py-4 text-sm text-destructive">
                <AlertCircle className="h-4 w-4" />
                {data.error}
              </CardContent>
            </Card>
          )}
          <div className="grid gap-4 lg:grid-cols-2">
            <WorkflowsCard workflows={data.workflows} />
            <ExecutionsCard executions={data.executions} />
          </div>
        </div>
      )}
    </div>
  );
}

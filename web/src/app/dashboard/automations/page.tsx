'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  History,
  Loader2,
  Play,
  RotateCcw,
  Terminal,
  XCircle,
} from 'lucide-react';
import { DashboardPageHeader } from '@/components/dashboard-page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  cancelAutomationTask,
  createAutomationTask,
  isTerminalTaskStatus,
  listAutomationTasks,
  retryAutomationTask,
  streamAutomationTask,
  type AutomationStep,
  type AutomationStepStatus,
  type AutomationTask,
  type AutomationTaskStatus,
  type CreateAutomationTaskInput,
} from '@/lib/automation';
import {
  getAutomations,
  type AutomationsResponse,
  type ExecutionSummary,
  type WorkflowSummary,
} from '@/lib/dashboard';

function taskStatusVariant(
  status: AutomationTaskStatus,
): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'completed':
      return 'default';
    case 'failed':
      return 'destructive';
    case 'cancelled':
      return 'outline';
    case 'queued':
    case 'awaiting_confirmation':
      return 'secondary';
    case 'planning':
    case 'running':
      return 'default';
  }
}

function stepStatusVariant(
  status: AutomationStepStatus,
): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'completed':
      return 'default';
    case 'failed':
    case 'rejected':
      return 'destructive';
    case 'running':
      return 'default';
    case 'queued':
    case 'awaiting_confirmation':
      return 'secondary';
  }
}

function n8nStatusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (['success', 'finished'].includes(status)) {
    return 'default';
  }
  if (['error', 'crashed', 'canceled', 'cancelled'].includes(status)) {
    return 'destructive';
  }
  return 'outline';
}

function formatDate(value: string | null | undefined): string {
  if (!value) {
    return '—';
  }
  return new Date(value).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function statusIcon(status: AutomationTaskStatus): React.JSX.Element | null {
  switch (status) {
    case 'completed':
      return <CheckCircle2 className="h-3.5 w-3.5" />;
    case 'failed':
      return <XCircle className="h-3.5 w-3.5" />;
    case 'running':
    case 'planning':
      return <Loader2 className="h-3.5 w-3.5 animate-spin" />;
    default:
      return null;
  }
}

function currentStep(task: AutomationTask): AutomationStep | undefined {
  if (task.steps.length === 0) {
    return undefined;
  }
  const index = Math.min(Math.max(task.currentStepIndex, 0), task.steps.length - 1);
  return task.steps[index];
}

function canCancel(status: AutomationTaskStatus): boolean {
  return ['queued', 'planning', 'running', 'awaiting_confirmation'].includes(status);
}

function canRetry(status: AutomationTaskStatus): boolean {
  return ['failed', 'cancelled'].includes(status);
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
              <Badge variant={n8nStatusVariant(execution.status)}>{execution.status}</Badge>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function CreateTaskForm({
  onCreate,
}: {
  onCreate: (input: CreateAutomationTaskInput) => Promise<void>;
}): React.JSX.Element {
  const [title, setTitle] = React.useState('');
  const [goal, setGoal] = React.useState('');
  const [maxRetries, setMaxRetries] = React.useState(2);
  const [continueOnError, setContinueOnError] = React.useState(false);
  const [notifyOnCompletion, setNotifyOnCompletion] = React.useState(true);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (submitting) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onCreate({
        title: title.trim(),
        goal: goal.trim(),
        options: { maxRetries, continueOnError, notifyOnCompletion },
      });
      setTitle('');
      setGoal('');
      setMaxRetries(2);
      setContinueOnError(false);
      setNotifyOnCompletion(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create task.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Create a task</CardTitle>
        <CardDescription>
          Describe a goal; BRO plans and runs it as a sequence of tool steps.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="task-title" className="text-sm font-medium">
              Title
            </label>
            <Input
              id="task-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Prep the weekly report"
              maxLength={120}
              required
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="task-goal" className="text-sm font-medium">
              Goal
            </label>
            <Textarea
              id="task-goal"
              value={goal}
              onChange={(event) => setGoal(event.target.value)}
              placeholder="Summarize this week's activity and send me a digest"
              maxLength={4000}
              required
            />
          </div>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={notifyOnCompletion}
                onChange={(event) => setNotifyOnCompletion(event.target.checked)}
              />
              Notify on completion
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={continueOnError}
                onChange={(event) => setContinueOnError(event.target.checked)}
              />
              Continue on error
            </label>
            <label className="flex items-center gap-2">
              Max retries
              <select
                className="rounded-md border border-input bg-transparent px-2 py-1"
                value={maxRetries}
                onChange={(event) => setMaxRetries(Number(event.target.value))}
              >
                {[0, 1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={submitting || !title.trim() || !goal.trim()}>
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            Create task
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function TaskCard({
  task,
  selected,
  busy,
  onSelect,
  onCancel,
  onRetry,
}: {
  task: AutomationTask;
  selected: boolean;
  busy: 'cancel' | 'retry' | null;
  onSelect: () => void;
  onCancel: () => void;
  onRetry: () => void;
}): React.JSX.Element {
  const step = currentStep(task);
  return (
    <div
      className={`rounded-lg border p-3 transition-colors ${
        selected ? 'border-neon-cyan/50 bg-neon-cyan/5' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <button
          type="button"
          onClick={onSelect}
          className="min-w-0 flex-1 text-left"
          aria-label={`Select task ${task.title}`}
        >
          <p className="truncate font-medium">{task.title}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Created {formatDate(task.createdAt)}
            {task.finishedAt ? ` · Finished ${formatDate(task.finishedAt)}` : ''}
          </p>
        </button>
        <Badge variant={taskStatusVariant(task.status)} className="gap-1">
          {statusIcon(task.status)}
          {task.status.replaceAll('_', ' ')}
        </Badge>
      </div>
      {step && (
        <p className="mt-2 truncate text-xs text-muted-foreground">
          {step.status === 'running' || step.status === 'awaiting_confirmation' ? (
            <>
              <Activity className="mr-1 inline h-3 w-3" />
              {step.description}
            </>
          ) : (
            `${step.toolName} — ${step.description}`
          )}
        </p>
      )}
      {task.error && <p className="mt-2 text-xs text-destructive">{task.error}</p>}
      <div className="mt-3 flex gap-2">
        {canCancel(task.status) && (
          <Button variant="outline" size="sm" onClick={onCancel} disabled={busy === 'cancel'}>
            {busy === 'cancel' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <XCircle className="h-3.5 w-3.5" />
            )}
            Cancel
          </Button>
        )}
        {canRetry(task.status) && (
          <Button variant="outline" size="sm" onClick={onRetry} disabled={busy === 'retry'}>
            {busy === 'retry' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RotateCcw className="h-3.5 w-3.5" />
            )}
            Retry
          </Button>
        )}
      </div>
    </div>
  );
}

function TaskDetail({ task }: { task: AutomationTask | null }): React.JSX.Element {
  if (!task) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Task details</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="py-6 text-center text-sm text-muted-foreground">
            Select a task to inspect its steps and logs.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{task.title}</CardTitle>
        <CardDescription>{task.goal}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant={taskStatusVariant(task.status)} className="gap-1">
            {statusIcon(task.status)}
            {task.status.replaceAll('_', ' ')}
          </Badge>
          <span>Created {formatDate(task.createdAt)}</span>
          {task.startedAt && <span>Started {formatDate(task.startedAt)}</span>}
          {task.finishedAt && <span>Finished {formatDate(task.finishedAt)}</span>}
          <span>Retries {task.options.maxRetries}</span>
        </div>

        <div>
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
            <Terminal className="h-4 w-4" />
            Steps
          </h3>
          {task.steps.length === 0 ? (
            <p className="text-sm text-muted-foreground">No steps planned yet.</p>
          ) : (
            <ol className="space-y-2">
              {task.steps.map((step) => (
                <li key={step.id} className="rounded-lg border p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium">
                      <span className="text-muted-foreground">#{step.order + 1}</span>{' '}
                      {step.toolName}
                    </p>
                    <Badge variant={stepStatusVariant(step.status)}>
                      {step.status.replaceAll('_', ' ')}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{step.description}</p>
                  {step.attempts > 1 && (
                    <p className="mt-1 text-xs text-muted-foreground">Attempts: {step.attempts}</p>
                  )}
                  {step.error && <p className="mt-1 text-xs text-destructive">{step.error}</p>}
                  {step.result && (
                    <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-muted/60 p-2 text-xs">
                      {step.result}
                    </pre>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>

        <div>
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
            <History className="h-4 w-4" />
            Logs
          </h3>
          {task.logs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No log entries yet.</p>
          ) : (
            <ol className="space-y-1">
              {task.logs.map((log, index) => (
                <li key={index} className="flex gap-2 text-xs">
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {new Date(log.at).toLocaleTimeString()}
                  </span>
                  <span
                    className={
                      log.level === 'error'
                        ? 'text-destructive'
                        : log.level === 'warn'
                          ? 'text-amber-500'
                          : 'text-muted-foreground'
                    }
                  >
                    {log.message}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function AutomationsPage(): React.JSX.Element {
  const router = useRouter();
  const { user, logout } = useAuth();
  const [tasks, setTasks] = React.useState<AutomationTask[]>([]);
  const [tasksLoaded, setTasksLoaded] = React.useState(false);
  const [tasksError, setTasksError] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<{ [id: string]: 'cancel' | 'retry' }>({});
  const [n8n, setN8n] = React.useState<AutomationsResponse | null>(null);
  const [n8nError, setN8nError] = React.useState<string | null>(null);
  const streamsRef = React.useRef(new Map<string, AbortController>());

  const upsertTask = React.useCallback((updated: AutomationTask): void => {
    setTasks((previous) => {
      const index = previous.findIndex((task) => task.id === updated.id);
      if (index === -1) {
        return [updated, ...previous];
      }
      const next = [...previous];
      next[index] = updated;
      return next;
    });
  }, []);

  React.useEffect(() => {
    let disposed = false;
    async function load(): Promise<void> {
      try {
        const list = await listAutomationTasks({ limit: 50 });
        if (!disposed) {
          setTasks(list);
          setTasksError(null);
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          await logout();
          router.replace('/login');
          return;
        }
        if (!disposed) {
          setTasksError('Failed to load automation tasks.');
        }
      } finally {
        if (!disposed) {
          setTasksLoaded(true);
        }
      }
    }
    void load();
    return () => {
      disposed = true;
    };
  }, [router, logout]);

  React.useEffect(() => {
    const streams = streamsRef.current;
    for (const task of tasks) {
      if (isTerminalTaskStatus(task.status) || streams.has(task.id)) {
        continue;
      }
      const controller = new AbortController();
      streams.set(task.id, controller);
      void streamAutomationTask(
        task.id,
        (event) => {
          if (event.type === 'snapshot' || event.type === 'update') {
            upsertTask(event.task);
            if (isTerminalTaskStatus(event.task.status)) {
              controller.abort();
              streams.delete(task.id);
            }
          }
        },
        controller.signal,
      ).catch(() => {
        streams.delete(task.id);
      });
    }
  }, [tasks, upsertTask]);

  React.useEffect(() => {
    const streams = streamsRef.current;
    return () => {
      for (const controller of streams.values()) {
        controller.abort();
      }
      streams.clear();
    };
  }, []);

  React.useEffect(() => {
    if (user?.role !== 'ADMIN') {
      return;
    }
    let disposed = false;
    async function loadN8n(): Promise<void> {
      try {
        const data = await getAutomations();
        if (!disposed) {
          setN8n(data);
          setN8nError(null);
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          await logout();
          router.replace('/login');
          return;
        }
        if (!disposed) {
          setN8nError('Failed to load n8n status.');
        }
      }
    }
    void loadN8n();
    return () => {
      disposed = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.role]);

  async function handleCreate(input: CreateAutomationTaskInput): Promise<void> {
    const task = await createAutomationTask(input);
    upsertTask(task);
    setSelectedId(task.id);
    setActionError(null);
  }

  async function handleCancel(id: string): Promise<void> {
    setBusy((previous) => ({ ...previous, [id]: 'cancel' }));
    setActionError(null);
    try {
      const task = await cancelAutomationTask(id);
      upsertTask(task);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to cancel task.');
    } finally {
      setBusy((previous) => {
        const next = { ...previous };
        delete next[id];
        return next;
      });
    }
  }

  async function handleRetry(id: string): Promise<void> {
    setBusy((previous) => ({ ...previous, [id]: 'retry' }));
    setActionError(null);
    try {
      const task = await retryAutomationTask(id);
      upsertTask(task);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to retry task.');
    } finally {
      setBusy((previous) => {
        const next = { ...previous };
        delete next[id];
        return next;
      });
    }
  }

  if (user === null) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const selectedTask = tasks.find((task) => task.id === selectedId) ?? null;

  return (
    <div>
      <DashboardPageHeader
        title="Automations"
        description="Create automation tasks BRO plans and runs, and monitor their progress in real time."
      />

      {(tasksError || actionError) && (
        <p className="mb-4 text-sm text-destructive">{tasksError ?? actionError}</p>
      )}

      {!tasksLoaded ? (
        <div className="flex min-h-[30vh] items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <CreateTaskForm onCreate={handleCreate} />
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Tasks</CardTitle>
                <CardDescription>Live updates stream for active tasks.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {tasks.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    No tasks yet. Create one above.
                  </p>
                ) : (
                  tasks.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      selected={task.id === selectedId}
                      busy={busy[task.id] ?? null}
                      onSelect={() => setSelectedId(task.id)}
                      onCancel={() => void handleCancel(task.id)}
                      onRetry={() => void handleRetry(task.id)}
                    />
                  ))
                )}
              </CardContent>
            </Card>
          </div>
          <div className="space-y-4">
            <TaskDetail task={selectedTask} />
          </div>
        </div>
      )}

      {user.role === 'ADMIN' && (
        <div className="mt-8">
          <h2 className="mb-3 text-lg font-semibold">n8n workflows</h2>
          {n8nError && <p className="mb-3 text-sm text-destructive">{n8nError}</p>}
          {n8n === null ? (
            <div className="flex min-h-[20vh] items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !n8n.enabled ? (
            <Card>
              <CardContent className="flex flex-col items-start gap-3 py-10">
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-5 w-5 text-muted-foreground" />
                  <p className="font-medium">n8n is not configured</p>
                </div>
                <p className="text-sm text-muted-foreground">
                  {n8n.error ??
                    'Set N8N_BASE_URL and N8N_API_KEY in your .env file to enable the automation tools.'}
                </p>
                <Button asChild variant="outline" size="sm">
                  <Link href="/settings">Open settings</Link>
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {n8n.error && (
                <Card>
                  <CardContent className="flex items-center gap-2 py-4 text-sm text-destructive">
                    <AlertCircle className="h-4 w-4" />
                    {n8n.error}
                  </CardContent>
                </Card>
              )}
              <div className="grid gap-4 lg:grid-cols-2">
                <WorkflowsCard workflows={n8n.workflows} />
                <ExecutionsCard executions={n8n.executions} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, RefreshCw, Trash2 } from 'lucide-react';
import { DashboardPageHeader } from '@/components/dashboard-page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { clearLogs, getLogs, type LogEntry } from '@/lib/dashboard';

const LEVELS = ['all', 'info', 'warn', 'error'] as const;
type LevelFilter = (typeof LEVELS)[number];

function levelVariant(level: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (level === 'error' || level === 'fatal') {
    return 'destructive';
  }
  if (level === 'warn') {
    return 'secondary';
  }
  return 'outline';
}

function matchesFilter(entry: LogEntry, filter: LevelFilter): boolean {
  if (filter === 'all') {
    return true;
  }
  if (filter === 'error') {
    return entry.level === 'error' || entry.level === 'fatal';
  }
  return entry.level === filter;
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleTimeString(undefined, { hour12: false });
}

function entrySummary(entry: LogEntry): string {
  const parts: string[] = [];
  const req = entry.req as { method?: string; url?: string } | null | undefined;
  if (req?.method && req.url) {
    parts.push(`${req.method} ${req.url}`);
  }
  const res = entry.res as { statusCode?: number } | null | undefined;
  if (res?.statusCode !== undefined) {
    parts.push(`→ ${res.statusCode}`);
  }
  return parts.length > 0 ? ` ${parts.join(' ')}` : '';
}

export default function LogsPage(): React.JSX.Element {
  const router = useRouter();
  const { logout } = useAuth();
  const [logs, setLogs] = React.useState<LogEntry[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState<LevelFilter>('all');
  const [clearing, setClearing] = React.useState(false);

  async function load(): Promise<void> {
    try {
      setLogs(await getLogs(200));
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        await logout();
        router.replace('/login');
        return;
      }
      setError('Failed to load logs.');
    }
  }

  React.useEffect(() => {
    void load();
    const interval = window.setInterval(() => {
      void load();
    }, 5000);
    return () => window.clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleClear(): Promise<void> {
    setClearing(true);
    try {
      await clearLogs();
      setLogs([]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to clear logs.');
    } finally {
      setClearing(false);
    }
  }

  const visible = logs?.filter((entry) => matchesFilter(entry, filter)) ?? [];

  return (
    <div>
      <DashboardPageHeader
        title="Logs"
        description="Recent server activity. Refreshes automatically every 5 seconds."
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          {LEVELS.map((level) => (
            <Button
              key={level}
              variant={filter === level ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFilter(level)}
            >
              {level}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void load()}>
            <RefreshCw className="mr-1 h-3.5 w-3.5" />
            Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleClear()}
            disabled={clearing}
          >
            <Trash2 className="mr-1 h-3.5 w-3.5" />
            {clearing ? 'Clearing…' : 'Clear'}
          </Button>
        </div>
      </div>

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      {logs === null ? (
        <div className="flex min-h-[30vh] items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : visible.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No logs to show{filter !== 'all' ? ` at level "${filter}"` : ''}.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="divide-y">
            {visible.map((entry, index) => (
              <div key={`${entry.time}-${index}`} className="flex items-start gap-3 py-2">
                <Badge variant={levelVariant(entry.level)}>{entry.level}</Badge>
                <span className="shrink-0 font-mono text-xs text-muted-foreground">
                  {formatTime(entry.time)}
                </span>
                <span className="min-w-0 flex-1 break-words text-sm">
                  {entry.msg}
                  <span className="text-muted-foreground">{entrySummary(entry)}</span>
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

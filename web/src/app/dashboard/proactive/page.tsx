'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { BellRing, Loader2, Plus, Save, Trash2, Zap } from 'lucide-react';
import { DashboardPageHeader } from '@/components/dashboard-page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  getProactiveSettings,
  getProactiveStatus,
  monitorSummary,
  monitorTypeLabel,
  MONITOR_TYPES,
  runProactiveSweep,
  updateProactiveSettings,
  type MonitorConfig,
  type MonitorType,
  type ProactiveSettings,
  type ProactiveSources,
  type ProactiveStatus,
  type ProactiveSweepResult,
} from '@/lib/proactive';

const SOURCE_OPTIONS: Array<{
  key: keyof ProactiveSources;
  label: string;
  description: string;
}> = [
  {
    key: 'build',
    label: 'Build failures',
    description: 'Alert when a build command exits non-zero.',
  },
  {
    key: 'devServer',
    label: 'Dev servers',
    description: 'Alert when a monitored port stops responding.',
  },
  {
    key: 'http',
    label: 'HTTP endpoints',
    description: 'Alert when a monitored URL stops returning 2xx.',
  },
  {
    key: 'lowDisk',
    label: 'Low disk space',
    description: 'Alert when disk usage crosses the threshold.',
  },
  { key: 'highCpu', label: 'High CPU', description: 'Alert when CPU load exceeds the threshold.' },
  { key: 'email', label: 'Email', description: 'Notify about unread mail from important senders.' },
  { key: 'calendar', label: 'Calendar', description: 'Remind about upcoming events in advance.' },
  {
    key: 'github',
    label: 'GitHub issues',
    description: 'Notify about open issues assigned to you.',
  },
];

const MONITOR_TYPE_OPTIONS: Array<{ value: MonitorType; label: string }> = MONITOR_TYPES.map(
  (value) => ({ value, label: monitorTypeLabel(value) }),
);

function formatSweep(sweep: ProactiveSweepResult): string {
  return `${new Date(sweep.checkedAt).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })} · ${sweep.users} users · ${sweep.notificationsCreated} created · ${sweep.suppressed} suppressed`;
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
}): React.JSX.Element {
  return (
    <label className="flex w-fit cursor-pointer items-center gap-2">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      {label && <span className="text-sm">{label}</span>}
    </label>
  );
}

function SourcesCard({
  sources,
  onChange,
}: {
  sources: ProactiveSources;
  onChange: (sources: ProactiveSources) => void;
}): React.JSX.Element {
  function set(key: keyof ProactiveSources, value: boolean): void {
    onChange({ ...sources, [key]: value });
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Monitoring sources</CardTitle>
        <CardDescription>
          Choose which conditions can produce notifications for you.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2">
        {SOURCE_OPTIONS.map((option) => (
          <label
            key={option.key}
            className="flex cursor-pointer items-start gap-3 rounded-lg border p-3"
          >
            <input
              type="checkbox"
              checked={sources[option.key]}
              onChange={(event) => set(option.key, event.target.checked)}
              className="mt-1"
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium">{option.label}</span>
              <span className="block text-xs text-muted-foreground">{option.description}</span>
            </span>
          </label>
        ))}
      </CardContent>
    </Card>
  );
}

function ThresholdsCard({
  settings,
  onChange,
}: {
  settings: ProactiveSettings;
  onChange: (settings: ProactiveSettings) => void;
}): React.JSX.Element {
  function setThreshold(key: keyof ProactiveSettings['thresholds'], value: number): void {
    onChange({ ...settings, thresholds: { ...settings.thresholds, [key]: value } });
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Thresholds</CardTitle>
        <CardDescription>System health alerting thresholds.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="threshold-cpu">CPU percent</Label>
          <Input
            id="threshold-cpu"
            type="number"
            min={0}
            max={100}
            value={settings.thresholds.cpuPercent}
            onChange={(event) => setThreshold('cpuPercent', Number(event.target.value))}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="threshold-disk-gb">Min free disk (GB)</Label>
          <Input
            id="threshold-disk-gb"
            type="number"
            min={0}
            step="0.5"
            value={settings.thresholds.diskFreeGb}
            onChange={(event) => setThreshold('diskFreeGb', Number(event.target.value))}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="threshold-disk-percent">Disk usage percent</Label>
          <Input
            id="threshold-disk-percent"
            type="number"
            min={0}
            max={100}
            value={settings.thresholds.diskPercent}
            onChange={(event) => setThreshold('diskPercent', Number(event.target.value))}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="threshold-cooldown">Cooldown (minutes)</Label>
          <Input
            id="threshold-cooldown"
            type="number"
            min={1}
            value={settings.cooldownMinutes}
            onChange={(event) =>
              onChange({ ...settings, cooldownMinutes: Number(event.target.value) })
            }
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="threshold-calendar-lead">Calendar lead (minutes)</Label>
          <Input
            id="threshold-calendar-lead"
            type="number"
            min={0}
            value={settings.calendarLeadMinutes}
            onChange={(event) =>
              onChange({ ...settings, calendarLeadMinutes: Number(event.target.value) })
            }
          />
        </div>
      </CardContent>
    </Card>
  );
}

function QuietHoursCard({
  settings,
  onChange,
}: {
  settings: ProactiveSettings;
  onChange: (settings: ProactiveSettings) => void;
}): React.JSX.Element {
  const quietHours = settings.quietHours;
  function set(patch: Partial<ProactiveSettings['quietHours']>): void {
    onChange({ ...settings, quietHours: { ...quietHours, ...patch } });
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Quiet hours</CardTitle>
        <CardDescription>
          Suppress low and medium priority notifications outside these hours.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Toggle checked={quietHours.enabled} onChange={(checked) => set({ enabled: checked })} />
        {quietHours.enabled && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="quiet-start">Start</Label>
              <Input
                id="quiet-start"
                type="time"
                value={quietHours.start}
                onChange={(event) => set({ start: event.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="quiet-end">End</Label>
              <Input
                id="quiet-end"
                type="time"
                value={quietHours.end}
                onChange={(event) => set({ end: event.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="quiet-timezone">Timezone (IANA)</Label>
              <Input
                id="quiet-timezone"
                placeholder="America/New_York"
                value={quietHours.timezone ?? ''}
                onChange={(event) =>
                  set({ timezone: event.target.value.trim() === '' ? null : event.target.value })
                }
              />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ImportantSendersCard({
  settings,
  onChange,
}: {
  settings: ProactiveSettings;
  onChange: (settings: ProactiveSettings) => void;
}): React.JSX.Element {
  const [value, setValue] = React.useState(settings.importantSenders.join(', '));

  React.useEffect(() => {
    setValue(settings.importantSenders.join(', '));
  }, [settings.importantSenders]);

  function commit(): void {
    const senders = value
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter((item) => item.length > 0);
    onChange({ ...settings, importantSenders: senders });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Important senders</CardTitle>
        <CardDescription>
          Emails from these addresses are treated as high-priority client replies.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onBlur={commit}
          placeholder="client@example.com, boss@example.com"
        />
      </CardContent>
    </Card>
  );
}

function MonitorEditor({
  monitors,
  onChange,
}: {
  monitors: MonitorConfig[];
  onChange: (monitors: MonitorConfig[]) => void;
}): React.JSX.Element {
  const [type, setType] = React.useState<MonitorType>('build');
  const [label, setLabel] = React.useState('');
  const [directory, setDirectory] = React.useState('');
  const [command, setCommand] = React.useState('');
  const [port, setPort] = React.useState('');
  const [url, setUrl] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  function add(event: React.FormEvent): void {
    event.preventDefault();
    const trimmedLabel = label.trim();
    if (!trimmedLabel) {
      setError('Label is required.');
      return;
    }
    let monitor: MonitorConfig | null = null;
    if (type === 'build') {
      const trimmedCommand = command.trim();
      const trimmedDirectory = directory.trim();
      if (!trimmedCommand || !trimmedDirectory) {
        setError('Command and directory are required for a build monitor.');
        return;
      }
      monitor = {
        id: `monitor-${Date.now()}`,
        type: 'build',
        label: trimmedLabel,
        command: trimmedCommand,
        directory: trimmedDirectory,
      };
    } else if (type === 'dev_server') {
      const parsedPort = Number(port);
      if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
        setError('Port must be an integer between 1 and 65535.');
        return;
      }
      monitor = {
        id: `monitor-${Date.now()}`,
        type: 'dev_server',
        label: trimmedLabel,
        port: parsedPort,
      };
    } else {
      const trimmedUrl = url.trim();
      if (!trimmedUrl) {
        setError('URL is required for an HTTP monitor.');
        return;
      }
      monitor = {
        id: `monitor-${Date.now()}`,
        type: 'http',
        label: trimmedLabel,
        url: trimmedUrl,
      };
    }
    onChange([...monitors, monitor]);
    setLabel('');
    setDirectory('');
    setCommand('');
    setPort('');
    setUrl('');
    setError(null);
  }

  function remove(id: string): void {
    onChange(monitors.filter((monitor) => monitor.id !== id));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Endpoint monitors</CardTitle>
        <CardDescription>Custom build commands, dev server ports, and HTTP checks.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {monitors.length === 0 ? (
          <p className="text-sm text-muted-foreground">No custom monitors configured.</p>
        ) : (
          <ul className="space-y-2">
            {monitors.map((monitor) => (
              <li
                key={monitor.id}
                className="flex items-center justify-between gap-3 rounded-lg border p-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium">{monitor.label}</p>
                    <Badge variant="outline">{monitorTypeLabel(monitor.type)}</Badge>
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {monitorSummary(monitor)}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Remove ${monitor.label}`}
                  onClick={() => remove(monitor.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={add} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="monitor-type">Type</Label>
            <select
              id="monitor-type"
              className="w-full rounded-md border border-input bg-transparent px-2 py-1.5 text-sm"
              value={type}
              onChange={(event) => {
                setType(event.target.value as MonitorType);
                setError(null);
              }}
            >
              {MONITOR_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="monitor-label">Label</Label>
            <Input
              id="monitor-label"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="Production build"
            />
          </div>
          {type === 'build' && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="monitor-directory">Working directory</Label>
                <Input
                  id="monitor-directory"
                  value={directory}
                  onChange={(event) => setDirectory(event.target.value)}
                  placeholder="C:\repo"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="monitor-command">Command</Label>
                <Input
                  id="monitor-command"
                  value={command}
                  onChange={(event) => setCommand(event.target.value)}
                  placeholder="npm run build"
                />
              </div>
            </>
          )}
          {type === 'dev_server' && (
            <div className="space-y-1.5">
              <Label htmlFor="monitor-port">Port</Label>
              <Input
                id="monitor-port"
                type="number"
                min={1}
                max={65535}
                value={port}
                onChange={(event) => setPort(event.target.value)}
                placeholder="3000"
              />
            </div>
          )}
          {type === 'http' && (
            <div className="space-y-1.5">
              <Label htmlFor="monitor-url">URL</Label>
              <Input
                id="monitor-url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://example.com/health"
              />
            </div>
          )}
          {error && <p className="text-sm text-destructive sm:col-span-2">{error}</p>}
          <Button type="submit" variant="outline" className="sm:col-span-2">
            <Plus className="h-4 w-4" />
            Add monitor
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export default function ProactivePage(): React.JSX.Element {
  const router = useRouter();
  const { logout } = useAuth();
  const [settings, setSettings] = React.useState<ProactiveSettings | null>(null);
  const [status, setStatus] = React.useState<ProactiveStatus | null>(null);
  const [loaded, setLoaded] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [running, setRunning] = React.useState(false);
  const [savedMessage, setSavedMessage] = React.useState<string | null>(null);

  React.useEffect(() => {
    let disposed = false;
    async function load(): Promise<void> {
      try {
        const [nextSettings, nextStatus] = await Promise.all([
          getProactiveSettings(),
          getProactiveStatus(),
        ]);
        if (!disposed) {
          setSettings(nextSettings);
          setStatus(nextStatus);
          setError(null);
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          await logout();
          router.replace('/login');
          return;
        }
        if (!disposed) {
          setError('Failed to load proactive settings.');
        }
      } finally {
        if (!disposed) {
          setLoaded(true);
        }
      }
    }
    void load();
    return () => {
      disposed = true;
    };
  }, [logout, router]);

  async function handleSave(): Promise<void> {
    if (!settings) {
      return;
    }
    setSaving(true);
    setError(null);
    setSavedMessage(null);
    try {
      const saved = await updateProactiveSettings(settings);
      setSettings(saved);
      setSavedMessage('Settings saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings.');
    } finally {
      setSaving(false);
    }
  }

  async function handleRunNow(): Promise<void> {
    setRunning(true);
    setError(null);
    try {
      const result = await runProactiveSweep();
      const nextStatus = await getProactiveStatus();
      setStatus({ ...nextStatus, lastSweep: result });
      setSavedMessage(`Sweep finished: ${formatSweep(result)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to run proactive sweep.');
    } finally {
      setRunning(false);
    }
  }

  if (!loaded) {
    return (
      <div className="flex min-h-[30vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!settings) {
    return (
      <div>
        <DashboardPageHeader
          title="Proactive monitoring"
          description="Configure automated alerts for your machine and services."
        />
        <p className="text-sm text-destructive">{error ?? 'Unable to load proactive settings.'}</p>
      </div>
    );
  }

  return (
    <div>
      <DashboardPageHeader
        title="Proactive monitoring"
        description="Let BRO watch your builds, services, inbox, and calendar and notify you before things go wrong."
      />

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}
      {savedMessage && <p className="mb-4 text-sm text-emerald-500">{savedMessage}</p>}

      <Card className="mb-4">
        <CardContent className="flex flex-wrap items-center justify-between gap-4 py-4">
          <div className="flex items-center gap-3">
            <BellRing className="h-5 w-5 text-neon-cyan" />
            <div>
              <p className="font-medium">
                Proactive monitoring is {settings.enabled ? 'enabled' : 'disabled'}
              </p>
              <p className="text-xs text-muted-foreground">
                Monitoring only runs while this is enabled.
              </p>
            </div>
          </div>
          <Toggle
            checked={settings.enabled}
            onChange={(enabled) => setSettings({ ...settings, enabled })}
          />
        </CardContent>
      </Card>

      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Monitor status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p>
              Interval:{' '}
              <span className="text-muted-foreground">
                {status && status.intervalMs > 0
                  ? `${Math.round(status.intervalMs / 60000)} minutes`
                  : 'not running'}
              </span>
            </p>
            <p>
              Last sweep:{' '}
              <span className="text-muted-foreground">
                {status?.lastSweep ? formatSweep(status.lastSweep) : 'never'}
              </span>
            </p>
            {status?.lastSweepError && (
              <p className="text-destructive">Last sweep error: {status.lastSweepError}</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Run now</CardTitle>
          </CardHeader>
          <CardContent>
            <Button onClick={() => void handleRunNow()} disabled={running || saving}>
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
              Run a sweep now
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        <SourcesCard
          sources={settings.sources}
          onChange={(sources) => setSettings({ ...settings, sources })}
        />
        <ThresholdsCard settings={settings} onChange={setSettings} />
        <QuietHoursCard settings={settings} onChange={setSettings} />
        <ImportantSendersCard settings={settings} onChange={setSettings} />
        <MonitorEditor
          monitors={settings.monitors}
          onChange={(monitors) => setSettings({ ...settings, monitors })}
        />
      </div>

      <div className="mt-6">
        <Button onClick={() => void handleSave()} disabled={saving || running}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save settings
        </Button>
      </div>
    </div>
  );
}

import type { Runner } from '../system/types.js';
import type {
  NotificationKind,
  NotificationPriority,
  ProactiveDraft,
  ProactiveSettings,
} from './types.js';
import type { HttpProbe, PortProbe, SystemSample } from './probes.js';

/** Injectable fetch that resolves to the parsed JSON body of a GET request. */
export type JsonFetcher = (
  url: string,
  init?: { headers?: Record<string, string> },
) => Promise<unknown>;

export interface EndpointProbeDeps {
  commandRunner: Runner;
  portProbe: PortProbe;
  httpProbe: HttpProbe;
  now: () => Date;
}

type GmailMessageHeader = { name?: string; value?: string };
type GmailMessage = {
  id?: string;
  snippet?: string;
  payload?: { headers?: GmailMessageHeader[] };
};
type CalendarEvent = {
  id?: string;
  summary?: string;
  start?: { dateTime?: string; date?: string };
};
type GitHubIssue = {
  id?: number;
  number?: number;
  title?: string;
  html_url?: string;
};

function headerValue(message: GmailMessage, name: string): string {
  const headers = message.payload?.headers ?? [];
  return headers.find((header) => header.name?.toLowerCase() === name.toLowerCase())?.value ?? '';
}

function emailFromHeader(value: string): string {
  const match = /<([^<>]+)>/.exec(value);
  return (match?.[1] ?? value).trim();
}

function isImportantSender(sender: string, importantSenders: string[]): boolean {
  const normalized = sender.toLowerCase();
  return importantSenders.some((entry) => {
    const candidate = entry.trim().toLowerCase();
    return candidate === normalized || normalized.endsWith(`@${candidate.replace(/^@/, '')}`);
  });
}

function stderrSnippet(stderr: string): string {
  const trimmed = stderr.trim();
  if (!trimmed) {
    return '';
  }
  return `: ${trimmed.split('\n').slice(0, 3).join(' ').slice(0, 200)}`;
}

/** Alerts for low disk space and high CPU, derived from a system sample. */
export function checkLocalMonitors(
  sample: SystemSample,
  settings: ProactiveSettings,
): ProactiveDraft[] {
  const drafts: ProactiveDraft[] = [];
  if (settings.sources.lowDisk) {
    for (const disk of sample.disks) {
      const usedPercent = disk.sizeGb > 0 ? ((disk.sizeGb - disk.freeGb) / disk.sizeGb) * 100 : 0;
      if (
        disk.sizeGb > 0 &&
        (disk.freeGb <= settings.thresholds.diskFreeGb ||
          usedPercent >= settings.thresholds.diskPercent)
      ) {
        drafts.push({
          kind: 'low_disk',
          priority: 'high',
          title: `Low disk space: ${disk.mount || 'system drive'}`,
          body: `${disk.freeGb.toFixed(1)} GB free (${usedPercent.toFixed(0)}% used).`,
          dedupeKey: `disk:${disk.mount || 'unknown'}`,
          metadata: { mount: disk.mount, freeGb: disk.freeGb, sizeGb: disk.sizeGb },
        });
      }
    }
  }
  if (settings.sources.highCpu && sample.cpuPercent >= settings.thresholds.cpuPercent) {
    drafts.push({
      kind: 'high_cpu',
      priority: 'high',
      title: `High CPU usage: ${sample.cpuPercent}%`,
      body: `CPU load exceeded ${settings.thresholds.cpuPercent}%.`,
      dedupeKey: 'cpu',
      metadata: { cpuPercent: sample.cpuPercent, threshold: settings.thresholds.cpuPercent },
    });
  }
  return drafts;
}

/** Runs user-defined build / dev server / HTTP checks. */
export async function checkEndpointMonitors(
  settings: ProactiveSettings,
  deps: EndpointProbeDeps,
): Promise<ProactiveDraft[]> {
  const drafts: ProactiveDraft[] = [];
  for (const monitor of settings.monitors) {
    if (monitor.type === 'build') {
      if (!settings.sources.build) {
        continue;
      }
      const result = await deps.commandRunner.shell(monitor.command, {
        cwd: monitor.directory || undefined,
        timeoutMs: 60_000,
      });
      if (result.code !== 0) {
        drafts.push({
          kind: 'build',
          priority: 'high',
          title: `Build check failed: ${monitor.label}`,
          body: `Command "${monitor.command}" exited with code ${result.code}${stderrSnippet(result.stderr)}`,
          dedupeKey: `build:${monitor.id}`,
          metadata: {
            monitorId: monitor.id,
            command: monitor.command,
            directory: monitor.directory,
            code: result.code,
          },
        });
      }
    } else if (monitor.type === 'dev_server') {
      if (!settings.sources.devServer) {
        continue;
      }
      const up = await deps.portProbe(monitor.port);
      if (!up) {
        drafts.push({
          kind: 'dev_server',
          priority: 'high',
          title: `Dev server stopped: ${monitor.label}`,
          body: `No process is listening on 127.0.0.1:${monitor.port}.`,
          dedupeKey: `dev_server:${monitor.id}`,
          metadata: { monitorId: monitor.id, port: monitor.port },
        });
      }
    } else if (monitor.type === 'http') {
      if (!settings.sources.http) {
        continue;
      }
      const result = await deps.httpProbe(monitor.url);
      if (!result.ok) {
        drafts.push({
          kind: 'http',
          priority: 'high',
          title: `Site down: ${monitor.label}`,
          body:
            result.status > 0
              ? `GET ${monitor.url} returned status ${result.status}.`
              : `GET ${monitor.url} could not be reached.`,
          dedupeKey: `http:${monitor.id}`,
          metadata: { monitorId: monitor.id, url: monitor.url, status: result.status },
        });
      }
    }
  }
  return drafts;
}

/** Alerts for unread Gmail messages; messages from important senders are high priority. */
export async function checkEmailMonitors(
  token: string,
  settings: ProactiveSettings,
  fetch: JsonFetcher,
): Promise<ProactiveDraft[]> {
  const authHeaders = { authorization: `Bearer ${token}` };
  const params = new URLSearchParams({ q: 'in:inbox is:unread newer_than:2d', maxResults: '10' });
  const list = (await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?${params.toString()}`,
    { headers: authHeaders },
  )) as { messages?: { id?: string }[] };

  const drafts: ProactiveDraft[] = [];
  for (const message of list.messages ?? []) {
    if (!message.id) {
      continue;
    }
    const detail = (await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${message.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
      { headers: authHeaders },
    )) as GmailMessage;
    const from = headerValue(detail, 'From');
    const subject = headerValue(detail, 'Subject') || '(no subject)';
    const sender = emailFromHeader(from);
    const important = isImportantSender(sender, settings.importantSenders);
    drafts.push({
      kind: 'email',
      priority: important ? 'high' : 'medium',
      title: important ? `Client reply: ${subject}` : `New email: ${subject}`,
      body: from ? `From ${from}` : null,
      dedupeKey: `email:${message.id}`,
      metadata: { messageId: message.id, from, subject, important },
    });
  }
  return drafts;
}

/** Alerts for calendar events starting within the configured lead time. */
export async function checkCalendarMonitors(
  token: string,
  settings: ProactiveSettings,
  fetch: JsonFetcher,
  now: Date,
): Promise<ProactiveDraft[]> {
  const authHeaders = { authorization: `Bearer ${token}` };
  const leadMs = settings.calendarLeadMinutes * 60_000;
  const params = new URLSearchParams({
    timeMin: now.toISOString(),
    timeMax: new Date(now.getTime() + leadMs).toISOString(),
    orderBy: 'startTime',
    singleEvents: 'true',
    maxResults: '10',
  });
  const body = (await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`,
    { headers: authHeaders },
  )) as { items?: CalendarEvent[] };

  const drafts: ProactiveDraft[] = [];
  for (const event of body.items ?? []) {
    if (!event.id) {
      continue;
    }
    const start = event.start?.dateTime ?? event.start?.date ?? null;
    drafts.push({
      kind: 'calendar',
      priority: 'medium',
      title: `Upcoming: ${event.summary ?? '(untitled)'}`,
      body: start,
      dedupeKey: `calendar:${event.id}`,
      metadata: { eventId: event.id, summary: event.summary ?? null, start },
    });
  }
  return drafts;
}

/** Alerts for open issues assigned to the user that were created recently. */
export async function checkGithubMonitors(
  token: string,
  settings: ProactiveSettings,
  fetch: JsonFetcher,
  now: Date,
): Promise<ProactiveDraft[]> {
  if (!settings.sources.github) {
    return [];
  }
  const authHeaders = {
    authorization: `Bearer ${token}`,
    accept: 'application/vnd.github+json',
  };
  const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const params = new URLSearchParams({
    filter: 'assigned',
    state: 'open',
    since,
    per_page: '30',
  });
  const issues = (await fetch(`https://api.github.com/issues?${params.toString()}`, {
    headers: authHeaders,
  })) as GitHubIssue[];

  const drafts: ProactiveDraft[] = [];
  for (const issue of issues ?? []) {
    if (issue.id === undefined || issue.number === undefined) {
      continue;
    }
    drafts.push({
      kind: 'github',
      priority: 'medium',
      title: `Issue #${issue.number}: ${issue.title ?? '(untitled)'}`,
      body: issue.html_url ?? null,
      dedupeKey: `github:${issue.id}`,
      metadata: {
        issueId: issue.id,
        number: issue.number,
        url: issue.html_url ?? null,
      },
    });
  }
  return drafts;
}

export type MonitorName = 'local' | 'endpoints' | 'email' | 'calendar' | 'github';

export function kindToDedupeMode(kind: NotificationKind): 'once' | 'cooldown' {
  return kind === 'email' || kind === 'calendar' || kind === 'github' ? 'once' : 'cooldown';
}

export function priorityLabel(priority: NotificationPriority): string {
  const labels: Record<NotificationPriority, string> = {
    low: 'Low',
    medium: 'Medium',
    high: 'High',
    critical: 'Critical',
  };
  return labels[priority];
}

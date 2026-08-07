import { request } from '@/lib/api';
import { getAccessToken } from '@/lib/token-store';

export type BaseMonitor = {
  id: string;
  label: string;
};

export type BuildMonitor = BaseMonitor & {
  type: 'build';
  directory: string;
  command: string;
};

export type DevServerMonitor = BaseMonitor & {
  type: 'dev_server';
  port: number;
};

export type HttpMonitor = BaseMonitor & {
  type: 'http';
  url: string;
};

export type MonitorConfig = BuildMonitor | DevServerMonitor | HttpMonitor;

export type QuietHoursSettings = {
  enabled: boolean;
  start: string;
  end: string;
  timezone: string | null;
};

export type ProactiveSources = {
  build: boolean;
  devServer: boolean;
  http: boolean;
  lowDisk: boolean;
  highCpu: boolean;
  email: boolean;
  calendar: boolean;
  github: boolean;
};

export type ProactiveSettings = {
  enabled: boolean;
  sources: ProactiveSources;
  monitors: MonitorConfig[];
  thresholds: {
    cpuPercent: number;
    diskFreeGb: number;
    diskPercent: number;
  };
  quietHours: QuietHoursSettings;
  cooldownMinutes: number;
  calendarLeadMinutes: number;
  importantSenders: string[];
};

export type ProactiveSweepResult = {
  checkedAt: string;
  users: number;
  notificationsCreated: number;
  suppressed: number;
  skipped: number;
  errors: Array<{ userId: string; source: string; message: string }>;
};

export type ProactiveStatus = {
  running: boolean;
  intervalMs: number;
  lastSweep: ProactiveSweepResult | null;
  lastSweepError: string | null;
};

export const MONITOR_TYPES = ['build', 'dev_server', 'http'] as const;
export type MonitorType = (typeof MONITOR_TYPES)[number];

export function isMonitorType(value: unknown): value is MonitorType {
  return typeof value === 'string' && (MONITOR_TYPES as readonly string[]).includes(value);
}

export function monitorTypeLabel(type: MonitorType): string {
  switch (type) {
    case 'build':
      return 'Build command';
    case 'dev_server':
      return 'Dev server port';
    case 'http':
      return 'HTTP endpoint';
  }
}

export function monitorSummary(monitor: MonitorConfig): string {
  switch (monitor.type) {
    case 'build':
      return `${monitor.command} (${monitor.directory})`;
    case 'dev_server':
      return `localhost:${monitor.port}`;
    case 'http':
      return monitor.url;
  }
}

function authToken(): string {
  const token = getAccessToken();
  if (!token) {
    throw new Error('Not authenticated');
  }
  return token;
}

export async function getProactiveSettings(): Promise<ProactiveSettings> {
  const result = await request<{ settings: ProactiveSettings }>('/proactive/settings', {
    token: authToken(),
  });
  return result.settings;
}

export async function updateProactiveSettings(
  settings: ProactiveSettings,
): Promise<ProactiveSettings> {
  const result = await request<{ settings: ProactiveSettings }>('/proactive/settings', {
    method: 'PUT',
    token: authToken(),
    body: { settings },
  });
  return result.settings;
}

export async function runProactiveSweep(): Promise<ProactiveSweepResult> {
  return request<ProactiveSweepResult>('/proactive/run', {
    method: 'POST',
    token: authToken(),
  });
}

export async function getProactiveStatus(): Promise<ProactiveStatus> {
  return request<ProactiveStatus>('/proactive/status', {
    token: authToken(),
  });
}

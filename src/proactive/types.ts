export const NOTIFICATION_PRIORITIES = ['low', 'medium', 'high', 'critical'] as const;
export type NotificationPriority = (typeof NOTIFICATION_PRIORITIES)[number];

export const NOTIFICATION_KINDS = [
  'build',
  'dev_server',
  'http',
  'low_disk',
  'high_cpu',
  'email',
  'calendar',
  'github',
  'automation',
  'system',
  'general',
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const PRIORITY_WEIGHT: Record<NotificationPriority, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

export function isNotificationPriority(value: unknown): value is NotificationPriority {
  return (
    typeof value === 'string' && NOTIFICATION_PRIORITIES.includes(value as NotificationPriority)
  );
}

export function isNotificationKind(value: unknown): value is NotificationKind {
  return typeof value === 'string' && NOTIFICATION_KINDS.includes(value as NotificationKind);
}

export interface BaseMonitor {
  id: string;
  label: string;
}

export interface BuildMonitor extends BaseMonitor {
  type: 'build';
  directory: string;
  command: string;
}

export interface DevServerMonitor extends BaseMonitor {
  type: 'dev_server';
  port: number;
}

export interface HttpMonitor extends BaseMonitor {
  type: 'http';
  url: string;
}

export type MonitorConfig = BuildMonitor | DevServerMonitor | HttpMonitor;

export interface QuietHoursSettings {
  enabled: boolean;
  /** 'HH:mm' 24-hour start time. */
  start: string;
  /** 'HH:mm' 24-hour end time. */
  end: string;
  /** IANA timezone name, e.g. 'America/New_York'. Null means the server's local time. */
  timezone: string | null;
}

export interface ProactiveSettings {
  /** Master toggle. Monitoring only runs for users with this enabled. */
  enabled: boolean;
  sources: {
    build: boolean;
    devServer: boolean;
    http: boolean;
    lowDisk: boolean;
    highCpu: boolean;
    email: boolean;
    calendar: boolean;
    github: boolean;
  };
  /** User-defined build / dev server / HTTP checks. */
  monitors: MonitorConfig[];
  thresholds: {
    /** CPU percentage that triggers a high_cpu notification. */
    cpuPercent: number;
    /** Free disk space (GB) below which a low_disk notification fires. */
    diskFreeGb: number;
    /** Disk usage percentage above which a low_disk notification fires. */
    diskPercent: number;
  };
  quietHours: QuietHoursSettings;
  /** Minimum minutes between repeated alerts for the same condition. */
  cooldownMinutes: number;
  /** Minutes before an event that a calendar reminder fires. */
  calendarLeadMinutes: number;
  /** Sender addresses whose email is treated as a high-priority "client reply". */
  importantSenders: string[];
}

export interface ProactiveDraft {
  kind: NotificationKind;
  priority: NotificationPriority;
  title: string;
  body: string | null;
  /** Stable key used to avoid re-notifying about the same item. */
  dedupeKey: string;
  metadata: Record<string, unknown>;
}

export interface ProactiveSweepResult {
  checkedAt: Date;
  users: number;
  notificationsCreated: number;
  suppressed: number;
  skipped: number;
  errors: Array<{ userId: string; source: string; message: string }>;
}

export interface ProactiveStatus {
  running: boolean;
  intervalMs: number;
  lastSweep: ProactiveSweepResult | null;
  lastSweepError: string | null;
}

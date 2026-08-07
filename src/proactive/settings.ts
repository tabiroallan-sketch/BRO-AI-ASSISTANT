import { randomUUID } from 'node:crypto';
import type { MonitorConfig, ProactiveSettings, QuietHoursSettings } from './types.js';

export const DEFAULT_PROACTIVE_SETTINGS: ProactiveSettings = {
  enabled: false,
  sources: {
    build: true,
    devServer: true,
    http: true,
    lowDisk: true,
    highCpu: true,
    email: true,
    calendar: true,
    github: true,
  },
  monitors: [],
  thresholds: {
    cpuPercent: 90,
    diskFreeGb: 5,
    diskPercent: 90,
  },
  quietHours: {
    enabled: false,
    start: '22:00',
    end: '07:00',
    timezone: null,
  },
  cooldownMinutes: 120,
  calendarLeadMinutes: 30,
  importantSenders: [],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(Math.max(value, min), max);
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(parsed, min), max);
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    const list = value
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter(Boolean);
    return [...new Set(list)];
  }
  if (typeof value === 'string' && value.trim()) {
    return value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return [];
}

/** Canonicalizes an 'H:mm'/'HH:mm' string to zero-padded 'HH:mm', or returns the fallback. */
function normalizeHHMM(value: unknown, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback;
  }
  const match = /^(\d{1,2}):([0-5]\d)$/.exec(value.trim());
  if (!match) {
    return fallback;
  }
  const hour = Number(match[1]);
  if (hour > 23) {
    return fallback;
  }
  return `${String(hour).padStart(2, '0')}:${match[2]}`;
}

function normalizeQuietHours(value: unknown): QuietHoursSettings {
  const fallback = DEFAULT_PROACTIVE_SETTINGS.quietHours;
  if (!isRecord(value)) {
    return { ...fallback };
  }
  return {
    enabled: typeof value.enabled === 'boolean' ? value.enabled : fallback.enabled,
    start: normalizeHHMM(value.start, fallback.start),
    end: normalizeHHMM(value.end, fallback.end),
    timezone:
      value.timezone === null
        ? null
        : typeof value.timezone === 'string' && value.timezone.trim()
          ? value.timezone
          : fallback.timezone,
  };
}

function normalizeSources(value: unknown): ProactiveSettings['sources'] {
  const fallback = DEFAULT_PROACTIVE_SETTINGS.sources;
  if (!isRecord(value)) {
    return { ...fallback };
  }
  return {
    build: typeof value.build === 'boolean' ? value.build : fallback.build,
    devServer: typeof value.devServer === 'boolean' ? value.devServer : fallback.devServer,
    http: typeof value.http === 'boolean' ? value.http : fallback.http,
    lowDisk: typeof value.lowDisk === 'boolean' ? value.lowDisk : fallback.lowDisk,
    highCpu: typeof value.highCpu === 'boolean' ? value.highCpu : fallback.highCpu,
    email: typeof value.email === 'boolean' ? value.email : fallback.email,
    calendar: typeof value.calendar === 'boolean' ? value.calendar : fallback.calendar,
    github: typeof value.github === 'boolean' ? value.github : fallback.github,
  };
}

function monitorLabel(monitor: Record<string, unknown>, fallback: string): string {
  if (typeof monitor.label === 'string' && monitor.label.trim()) {
    return monitor.label.trim().slice(0, 120);
  }
  return fallback;
}

function normalizeMonitors(value: unknown): MonitorConfig[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const monitors: MonitorConfig[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) {
      continue;
    }
    const id = typeof entry.id === 'string' && entry.id.trim() ? entry.id : randomUUID();
    const type = entry.type;
    if (type === 'build' && typeof entry.command === 'string' && entry.command.trim()) {
      monitors.push({
        id,
        type: 'build',
        label: monitorLabel(entry, entry.command),
        directory: typeof entry.directory === 'string' ? entry.directory.trim() : '',
        command: entry.command.trim(),
      });
    } else if (type === 'dev_server') {
      const port = Number(entry.port);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        continue;
      }
      monitors.push({
        id,
        type: 'dev_server',
        label: monitorLabel(entry, `Port ${port}`),
        port,
      });
    } else if (type === 'http' && typeof entry.url === 'string') {
      let url = entry.url.trim();
      if (url && !/^https?:\/\//i.test(url)) {
        url = `https://${url}`;
      }
      try {
        new URL(url);
      } catch {
        continue;
      }
      monitors.push({
        id,
        type: 'http',
        label: monitorLabel(entry, url),
        url,
      });
    }
  }
  return monitors;
}

/**
 * Merges partial, unknown-shaped input (stored User.settings JSON or a client
 * PUT payload) onto the defaults, coercing and clamping values.
 */
export function normalizeSettings(input: unknown): ProactiveSettings {
  if (!isRecord(input)) {
    return structuredClone(DEFAULT_PROACTIVE_SETTINGS);
  }
  const thresholds = isRecord(input.thresholds) ? input.thresholds : {};
  const defaults = DEFAULT_PROACTIVE_SETTINGS;
  return {
    enabled: typeof input.enabled === 'boolean' ? input.enabled : defaults.enabled,
    sources: normalizeSources(input.sources),
    monitors: normalizeMonitors(input.monitors),
    thresholds: {
      cpuPercent: clampNumber(thresholds.cpuPercent, 1, 100, defaults.thresholds.cpuPercent),
      diskFreeGb: clampNumber(thresholds.diskFreeGb, 0.1, 1000, defaults.thresholds.diskFreeGb),
      diskPercent: clampNumber(thresholds.diskPercent, 1, 100, defaults.thresholds.diskPercent),
    },
    quietHours: normalizeQuietHours(input.quietHours),
    cooldownMinutes: clampInt(input.cooldownMinutes, 5, 1440, defaults.cooldownMinutes),
    calendarLeadMinutes: clampInt(input.calendarLeadMinutes, 5, 1440, defaults.calendarLeadMinutes),
    importantSenders: stringList(input.importantSenders),
  };
}

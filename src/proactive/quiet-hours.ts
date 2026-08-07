import type { NotificationPriority, QuietHoursSettings } from './types.js';

/**
 * Parses an 'HH:mm' 24-hour string into minutes since midnight. Returns null
 * for invalid input.
 */
export function parseHHMM(value: string): number | null {
  const match = /^(\d{1,2}):([0-5]\d)$/.exec(value.trim());
  if (!match) {
    return null;
  }
  const hour = Number(match[1]);
  if (hour > 23) {
    return null;
  }
  return hour * 60 + Number(match[2]);
}

/**
 * Minutes since midnight for the given date, in the target IANA timezone
 * (or the server's local time when timezone is null).
 */
export function minutesOfDay(date: Date, timezone: string | null): number {
  if (!timezone) {
    return date.getHours() * 60 + date.getMinutes();
  }
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0') % 24;
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? '0');
  return hour * 60 + minute;
}

/**
 * True when the date falls inside the quiet-hours window. Windows that wrap
 * past midnight (start > end) are handled by splitting the day.
 */
export function isQuietHours(date: Date, quiet: QuietHoursSettings): boolean {
  if (!quiet.enabled) {
    return false;
  }
  const start = parseHHMM(quiet.start);
  const end = parseHHMM(quiet.end);
  if (start === null || end === null) {
    return false;
  }
  const now = minutesOfDay(date, quiet.timezone);
  if (start < end) {
    return now >= start && now < end;
  }
  return now >= start || now < end;
}

/**
 * Whether a notification of this priority should be held back during quiet
 * hours. Low/medium alerts are suppressed; high/critical still come through.
 */
export function shouldSuppressForQuietHours(
  priority: NotificationPriority,
  quiet: QuietHoursSettings,
): boolean {
  if (!quiet.enabled) {
    return false;
  }
  return priority === 'low' || priority === 'medium';
}

export function isSuppressedDuringQuietHours(
  priority: NotificationPriority,
  quiet: QuietHoursSettings,
  date: Date,
): boolean {
  return isQuietHours(date, quiet) && shouldSuppressForQuietHours(priority, quiet);
}

import { describe, expect, it } from 'vitest';
import {
  isQuietHours,
  isSuppressedDuringQuietHours,
  minutesOfDay,
  parseHHMM,
  shouldSuppressForQuietHours,
} from '../../src/proactive/quiet-hours.js';
import type { QuietHoursSettings } from '../../src/proactive/types.js';

const disabled: QuietHoursSettings = {
  enabled: false,
  start: '22:00',
  end: '07:00',
  timezone: null,
};

describe('parseHHMM', () => {
  it('parses valid 24-hour times', () => {
    expect(parseHHMM('00:00')).toBe(0);
    expect(parseHHMM('9:30')).toBe(570);
    expect(parseHHMM('09:30')).toBe(570);
    expect(parseHHMM('23:59')).toBe(1439);
  });

  it('rejects invalid input', () => {
    expect(parseHHMM('24:00')).toBeNull();
    expect(parseHHMM('09:60')).toBeNull();
    expect(parseHHMM('nope')).toBeNull();
  });
});

describe('isQuietHours', () => {
  it('returns false when disabled', () => {
    const date = new Date(2026, 7, 7, 23, 30);
    expect(isQuietHours(date, disabled)).toBe(false);
  });

  it('handles a same-day window', () => {
    const quiet: QuietHoursSettings = {
      enabled: true,
      start: '09:00',
      end: '17:00',
      timezone: null,
    };
    expect(isQuietHours(new Date(2026, 7, 7, 8, 59), quiet)).toBe(false);
    expect(isQuietHours(new Date(2026, 7, 7, 9, 0), quiet)).toBe(true);
    expect(isQuietHours(new Date(2026, 7, 7, 16, 59), quiet)).toBe(true);
    expect(isQuietHours(new Date(2026, 7, 7, 17, 0), quiet)).toBe(false);
  });

  it('handles a window that wraps past midnight', () => {
    const quiet: QuietHoursSettings = {
      enabled: true,
      start: '22:00',
      end: '07:00',
      timezone: null,
    };
    expect(isQuietHours(new Date(2026, 7, 7, 23, 30), quiet)).toBe(true);
    expect(isQuietHours(new Date(2026, 7, 8, 6, 30), quiet)).toBe(true);
    expect(isQuietHours(new Date(2026, 7, 8, 7, 0), quiet)).toBe(false);
    expect(isQuietHours(new Date(2026, 7, 8, 12, 0), quiet)).toBe(false);
  });

  it('evaluates in the configured timezone', () => {
    const quiet: QuietHoursSettings = {
      enabled: true,
      start: '22:00',
      end: '23:00',
      timezone: 'UTC',
    };
    expect(isQuietHours(new Date('2026-08-07T22:30:00Z'), quiet)).toBe(true);
    expect(isQuietHours(new Date('2026-08-07T21:30:00Z'), quiet)).toBe(false);
  });

  it('returns false for invalid windows', () => {
    const quiet: QuietHoursSettings = {
      enabled: true,
      start: 'not-a-time',
      end: '07:00',
      timezone: null,
    };
    expect(isQuietHours(new Date(2026, 7, 7, 23, 30), quiet)).toBe(false);
  });
});

describe('minutesOfDay', () => {
  it('uses local time when no timezone is set', () => {
    const date = new Date(2026, 7, 7, 10, 15);
    expect(minutesOfDay(date, null)).toBe(615);
  });

  it('uses the IANA timezone when provided', () => {
    const date = new Date('2026-08-07T22:30:00Z');
    expect(minutesOfDay(date, 'UTC')).toBe(22 * 60 + 30);
  });
});

describe('shouldSuppressForQuietHours', () => {
  it('suppresses low and medium priorities', () => {
    expect(shouldSuppressForQuietHours('low', disabled)).toBe(false);
    expect(shouldSuppressForQuietHours('medium', disabled)).toBe(false);
    expect(shouldSuppressForQuietHours('low', { ...disabled, enabled: true })).toBe(true);
    expect(shouldSuppressForQuietHours('medium', { ...disabled, enabled: true })).toBe(true);
  });

  it('always lets high and critical through', () => {
    const quiet: QuietHoursSettings = { ...disabled, enabled: true };
    expect(shouldSuppressForQuietHours('high', quiet)).toBe(false);
    expect(shouldSuppressForQuietHours('critical', quiet)).toBe(false);
  });
});

describe('isSuppressedDuringQuietHours', () => {
  it('combines the window and priority policy', () => {
    const quiet: QuietHoursSettings = {
      enabled: true,
      start: '22:00',
      end: '23:00',
      timezone: null,
    };
    const inWindow = new Date(2026, 7, 7, 22, 30);
    expect(isSuppressedDuringQuietHours('medium', quiet, inWindow)).toBe(true);
    expect(isSuppressedDuringQuietHours('high', quiet, inWindow)).toBe(false);
    expect(isSuppressedDuringQuietHours('medium', quiet, new Date(2026, 7, 7, 12, 0))).toBe(false);
  });
});

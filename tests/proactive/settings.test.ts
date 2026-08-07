import { describe, expect, it } from 'vitest';
import { DEFAULT_PROACTIVE_SETTINGS, normalizeSettings } from '../../src/proactive/settings.js';

describe('normalizeSettings', () => {
  it('returns defaults for empty input', () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_PROACTIVE_SETTINGS);
    expect(normalizeSettings(null)).toEqual(DEFAULT_PROACTIVE_SETTINGS);
    expect(normalizeSettings('garbage')).toEqual(DEFAULT_PROACTIVE_SETTINGS);
  });

  it('merges partial input onto defaults', () => {
    const result = normalizeSettings({ enabled: true, sources: { email: false } });
    expect(result.enabled).toBe(true);
    expect(result.sources.email).toBe(false);
    expect(result.sources.calendar).toBe(true);
    expect(result.sources.build).toBe(true);
    expect(result.thresholds).toEqual(DEFAULT_PROACTIVE_SETTINGS.thresholds);
  });

  it('clamps threshold values', () => {
    const result = normalizeSettings({
      thresholds: { cpuPercent: 500, diskFreeGb: 0, diskPercent: -3 },
    });
    expect(result.thresholds.cpuPercent).toBe(100);
    expect(result.thresholds.diskFreeGb).toBe(0.1);
    expect(result.thresholds.diskPercent).toBe(1);
  });

  it('clamps cooldown and calendar lead minutes', () => {
    const result = normalizeSettings({ cooldownMinutes: 2, calendarLeadMinutes: 5000 });
    expect(result.cooldownMinutes).toBe(5);
    expect(result.calendarLeadMinutes).toBe(1440);
  });

  it('normalizes quiet hours, falling back for invalid times', () => {
    const result = normalizeSettings({
      quietHours: { enabled: true, start: '9:00', end: '27:00', timezone: '' },
    });
    expect(result.quietHours.enabled).toBe(true);
    expect(result.quietHours.start).toBe('09:00');
    expect(result.quietHours.end).toBe(DEFAULT_PROACTIVE_SETTINGS.quietHours.end);
    expect(result.quietHours.timezone).toBe(DEFAULT_PROACTIVE_SETTINGS.quietHours.timezone);
  });

  it('accepts a valid quiet hours window', () => {
    const result = normalizeSettings({
      quietHours: { enabled: true, start: '22:00', end: '07:00', timezone: 'America/New_York' },
    });
    expect(result.quietHours).toEqual({
      enabled: true,
      start: '22:00',
      end: '07:00',
      timezone: 'America/New_York',
    });
  });

  it('normalizes important senders as a unique string list', () => {
    const result = normalizeSettings({
      importantSenders: ['acme.com', ' bob@example.com ', 'acme.com'],
    });
    expect(result.importantSenders).toEqual(['acme.com', 'bob@example.com']);
  });

  it('normalizes a comma-separated sender string', () => {
    const result = normalizeSettings({ importantSenders: 'a.com, b.com' });
    expect(result.importantSenders).toEqual(['a.com', 'b.com']);
  });

  it('keeps valid build monitors and drops invalid ones', () => {
    const result = normalizeSettings({
      monitors: [
        {
          id: 'm1',
          type: 'build',
          label: 'Typecheck',
          command: 'npx tsc --noEmit',
          directory: '/app',
        },
        { id: 'm2', type: 'dev_server', label: 'Web', port: 3000 },
        { id: 'm3', type: 'http', url: 'example.com' },
        { type: 'build' },
        { id: 'm5', type: 'dev_server', port: 99999 },
        { type: 'http', url: 'not a url' },
      ],
    });
    expect(result.monitors).toHaveLength(3);
    expect(result.monitors[0]).toMatchObject({ type: 'build', command: 'npx tsc --noEmit' });
    expect(result.monitors[1]).toMatchObject({ type: 'dev_server', port: 3000 });
    expect(result.monitors[2]).toMatchObject({ type: 'http', url: 'https://example.com' });
  });

  it('generates ids for monitors that lack one', () => {
    const result = normalizeSettings({ monitors: [{ type: 'build', command: 'npm test' }] });
    expect(result.monitors[0]?.id).toBeTruthy();
  });

  it('preserves valid ids', () => {
    const result = normalizeSettings({
      monitors: [{ id: 'keep-me', type: 'build', command: 'x' }],
    });
    expect(result.monitors[0]?.id).toBe('keep-me');
  });

  it('drops a non-array monitors value', () => {
    expect(normalizeSettings({ monitors: 'nope' }).monitors).toEqual([]);
  });
});

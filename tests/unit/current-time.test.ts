import { describe, expect, it } from 'vitest';
import { currentTimeTool } from '../../src/tools/current-time.js';

describe('get_current_time tool', () => {
  it('returns an ISO timestamp for the current time', () => {
    const output = currentTimeTool.execute({});
    expect(output).toMatch(/ISO 8601 \(UTC\): \d{4}-\d{2}-\d{2}T/);
  });

  it('includes local time for a valid time zone', () => {
    const output = currentTimeTool.execute({ timezone: 'Asia/Tokyo' });
    expect(output).toContain('Local time (Asia/Tokyo):');
  });

  it('falls back to UTC for an invalid time zone', () => {
    const output = currentTimeTool.execute({ timezone: 'Not/AZone' });
    expect(output).toContain('Invalid timezone "Not/AZone" provided; showing UTC.');
  });
});

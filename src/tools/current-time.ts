import type { Tool } from './types.js';

const timeZones = Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';

export const currentTimeTool: Tool = {
  name: 'get_current_time',
  answerFinal: true,
  description:
    'Return the current date and time in UTC as an ISO 8601 string, and as a human-readable local time in the requested time zone (optional). Use this whenever the user asks what time it is or what the current date is. Time zones are IANA names such as "UTC", "America/New_York", "Europe/London" or "Asia/Tokyo".',
  parameters: {
    type: 'object',
    properties: {
      timezone: {
        type: 'string',
        description: `Optional IANA time zone name. Defaults to the server time zone (${timeZones}).`,
      },
    },
    additionalProperties: false,
  },
  execute(args) {
    const now = new Date();
    const iso = now.toISOString();
    const timezone =
      typeof args.timezone === 'string' && args.timezone.trim() ? args.timezone.trim() : timeZones;
    try {
      const local = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        dateStyle: 'full',
        timeStyle: 'long',
      }).format(now);
      return `ISO 8601 (UTC): ${iso}\nLocal time (${timezone}): ${local}`;
    } catch {
      return `ISO 8601 (UTC): ${iso}\nInvalid timezone "${timezone}" provided; showing UTC.`;
    }
  },
};

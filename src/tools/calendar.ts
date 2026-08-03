import { requireProviderToken } from '../integrations/access.js';
import type { Tool } from './types.js';

type CalendarEvent = {
  id?: string;
  summary?: string;
  description?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
};

type FetchInit = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
};

async function googleCalendarRequest(
  token: string,
  path: string,
  init: FetchInit = {},
): Promise<Response> {
  return fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
}

export const calendarListEventsTool: Tool = {
  name: 'calendar_list_events',
  description:
    'List upcoming events on the user\u2019s Google Calendar. Returns the next events with title, time, and description.',
  parameters: {
    type: 'object',
    properties: {
      maxResults: {
        type: 'string',
        description: 'Maximum number of events to return (default 10).',
      },
      timeMin: {
        type: 'string',
        description:
          'ISO 8601 date-time from which to list events. Defaults to now, e.g. "2026-08-03T10:00:00Z".',
      },
    },
  },
  async execute(args, context) {
    const token = await requireProviderToken(context.userId, 'google-calendar');
    const maxResults = typeof args.maxResults === 'string' ? args.maxResults : '10';
    const timeMin = typeof args.timeMin === 'string' ? args.timeMin : new Date().toISOString();
    const params = new URLSearchParams({
      maxResults,
      orderBy: 'startTime',
      singleEvents: 'true',
      timeMin,
    });
    const response = await googleCalendarRequest(
      token,
      `/calendars/primary/events?${params.toString()}`,
    );
    if (!response.ok) {
      throw new Error(`Google Calendar request failed with status ${response.status}`);
    }
    const body = (await response.json()) as { items?: CalendarEvent[] };
    const events = body.items ?? [];
    if (events.length === 0) {
      return 'No upcoming events found.';
    }
    const lines = events.map((event, index) => {
      const start = event.start?.dateTime ?? event.start?.date ?? 'unknown time';
      const end = event.end?.dateTime ?? event.end?.date ?? '';
      const desc = event.description ? `\n  ${event.description}` : '';
      return `${index + 1}. ${event.summary ?? '(untitled)'} (${start}${end ? ` to ${end}` : ''})${desc}`;
    });
    return lines.join('\n');
  },
};

export const calendarCreateEventTool: Tool = {
  name: 'calendar_create_event',
  description:
    'Create a new event on the user\u2019s Google Calendar. Provide a title, start, and end date-time in ISO 8601 format.',
  parameters: {
    type: 'object',
    properties: {
      summary: { type: 'string', description: 'Event title.' },
      description: { type: 'string', description: 'Optional event description.' },
      start: {
        type: 'string',
        description: 'Start date-time in ISO 8601 format, e.g. "2026-08-05T09:00:00".',
      },
      end: {
        type: 'string',
        description: 'End date-time in ISO 8601 format, e.g. "2026-08-05T10:00:00".',
      },
    },
    required: ['summary', 'start', 'end'],
  },
  async execute(args, context) {
    const summary = typeof args.summary === 'string' ? args.summary.trim() : '';
    const start = typeof args.start === 'string' ? args.start.trim() : '';
    const end = typeof args.end === 'string' ? args.end.trim() : '';
    if (!summary || !start || !end) {
      throw new Error('Missing "summary", "start", or "end" argument');
    }
    const token = await requireProviderToken(context.userId, 'google-calendar');
    const description =
      typeof args.description === 'string' && args.description.trim()
        ? args.description.trim()
        : undefined;
    const body = {
      summary,
      ...(description ? { description } : {}),
      start: { dateTime: start },
      end: { dateTime: end },
    };
    const response = await googleCalendarRequest(token, '/calendars/primary/events', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`Google Calendar request failed with status ${response.status}`);
    }
    const created = (await response.json()) as CalendarEvent;
    return `Event created: "${created.summary}" at ${created.start?.dateTime ?? ''} (id: ${created.id ?? 'unknown'})`;
  },
};

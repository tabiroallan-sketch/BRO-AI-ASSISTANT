import { requirePermission } from '../integrations/access.js';
import type { Tool } from './types.js';
import { fetchWithTimeout } from '../lib/http.js';

type CalendarEvent = {
  id?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  recurrence?: string[];
  attendees?: { email?: string; responseStatus?: string }[];
  status?: string;
};

type CalendarEntry = {
  id?: string;
  summary?: string;
  description?: string;
  primary?: boolean;
  timeZone?: string;
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
  return fetchWithTimeout(`https://www.googleapis.com/calendar/v3${path}`, {
    ...init,
    timeoutMs: 10_000,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
}

export const calendarListEventsTool: Tool = {
  name: 'calendar_list_events',
  providerId: 'google-calendar',
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
    const token = await requirePermission(context.userId, 'google-calendar', 'calendar.read');
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
  providerId: 'google-calendar',
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
      location: {
        type: 'string',
        description: 'Optional event location.',
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
    const token = await requirePermission(context.userId, 'google-calendar', 'calendar.write');
    const description =
      typeof args.description === 'string' && args.description.trim()
        ? args.description.trim()
        : undefined;
    const location =
      typeof args.location === 'string' && args.location.trim() ? args.location.trim() : undefined;
    const body: Record<string, unknown> = {
      summary,
      start: { dateTime: start },
      end: { dateTime: end },
    };
    if (description) body.description = description;
    if (location) body.location = location;
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

export const calendarUpdateEventTool: Tool = {
  name: 'calendar_update_event',
  providerId: 'google-calendar',
  description: 'Update an existing event on the user\u2019s Google Calendar.',
  parameters: {
    type: 'object',
    properties: {
      eventId: {
        type: 'string',
        description: 'The event ID to update (from calendar_list_events).',
      },
      summary: { type: 'string', description: 'New event title (optional).' },
      description: { type: 'string', description: 'New event description (optional).' },
      start: {
        type: 'string',
        description: 'New start date-time in ISO 8601 format (optional).',
      },
      end: {
        type: 'string',
        description: 'New end date-time in ISO 8601 format (optional).',
      },
      location: { type: 'string', description: 'New location (optional).' },
    },
    required: ['eventId'],
  },
  async execute(args, context) {
    const eventId = typeof args.eventId === 'string' ? args.eventId.trim() : '';
    if (!eventId) {
      throw new Error('Missing "eventId" argument');
    }
    const token = await requirePermission(context.userId, 'google-calendar', 'calendar.write');
    const payload: Record<string, unknown> = {};
    const summary = typeof args.summary === 'string' ? args.summary.trim() : '';
    const description = typeof args.description === 'string' ? args.description.trim() : '';
    const start = typeof args.start === 'string' ? args.start.trim() : '';
    const end = typeof args.end === 'string' ? args.end.trim() : '';
    const location = typeof args.location === 'string' ? args.location.trim() : '';
    if (summary) payload.summary = summary;
    if (description) payload.description = description;
    if (start) payload.start = { dateTime: start };
    if (end) payload.end = { dateTime: end };
    if (location) payload.location = location;
    if (Object.keys(payload).length === 0) {
      throw new Error('Provide at least one field to update');
    }
    const response = await googleCalendarRequest(
      token,
      `/calendars/primary/events/${encodeURIComponent(eventId)}`,
      { method: 'PATCH', body: JSON.stringify(payload) },
    );
    if (!response.ok) {
      throw new Error(`Google Calendar request failed with status ${response.status}`);
    }
    const updated = (await response.json()) as CalendarEvent;
    return `Event updated: "${updated.summary ?? eventId}" (id: ${updated.id ?? eventId})`;
  },
};

export const calendarDeleteEventTool: Tool = {
  name: 'calendar_delete_event',
  providerId: 'google-calendar',
  description: 'Delete an event from the user\u2019s Google Calendar.',
  requireConfirmation: true,
  parameters: {
    type: 'object',
    properties: {
      eventId: { type: 'string', description: 'The event ID to delete.' },
    },
    required: ['eventId'],
  },
  async execute(args, context) {
    const eventId = typeof args.eventId === 'string' ? args.eventId.trim() : '';
    if (!eventId) {
      throw new Error('Missing "eventId" argument');
    }
    const token = await requirePermission(context.userId, 'google-calendar', 'calendar.write');
    const response = await googleCalendarRequest(
      token,
      `/calendars/primary/events/${encodeURIComponent(eventId)}`,
      { method: 'DELETE' },
    );
    if (!response.ok) {
      throw new Error(`Google Calendar request failed with status ${response.status}`);
    }
    return `Event ${eventId} deleted.`;
  },
};

export const calendarListCalendarsTool: Tool = {
  name: 'calendar_list_calendars',
  providerId: 'google-calendar',
  description: 'List all the user\u2019s Google Calendars with their IDs and names.',
  parameters: {
    type: 'object',
    properties: {},
  },
  async execute(_args, context) {
    const token = await requirePermission(context.userId, 'google-calendar', 'calendar.read');
    const response = await googleCalendarRequest(token, '/users/me/calendarList');
    if (!response.ok) {
      throw new Error(`Google Calendar request failed with status ${response.status}`);
    }
    const body = (await response.json()) as { items?: CalendarEntry[] };
    const calendars = body.items ?? [];
    if (calendars.length === 0) {
      return 'No calendars found.';
    }
    const lines = calendars.map(
      (cal, index) =>
        `${index + 1}. ${cal.summary ?? '(unnamed)'}${cal.primary ? ' (primary)' : ''} (id: ${cal.id ?? 'unknown'}, tz: ${cal.timeZone ?? 'unknown'})`,
    );
    return lines.join('\n');
  },
};

import { requirePermission } from '../integrations/access.js';
import { fetchWithTimeout } from '../lib/http.js';
import type { Tool } from './types.js';

type ContactPerson = {
  resourceName?: string;
  names?: { displayName?: string }[];
  emailAddresses?: { value?: string }[];
  phoneNumbers?: { value?: string }[];
  organizations?: { name?: string; title?: string }[];
};

export const contactsSearchTool: Tool = {
  name: 'contacts_search',
  providerId: 'google-contacts',
  description:
    'Search the user\u2019s Google Contacts for people matching a name or email and return their contact details.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Contact search query, e.g. a name or email address.',
      },
      maxResults: {
        type: 'string',
        description: 'Maximum number of contacts to return (default 10).',
      },
    },
    required: ['query'],
  },
  async execute(args, context) {
    const query = typeof args.query === 'string' ? args.query.trim() : '';
    if (!query) {
      throw new Error('Missing "query" argument');
    }
    const maxResults = typeof args.maxResults === 'string' ? args.maxResults : '10';
    const token = await requirePermission(context.userId, 'google-contacts', 'contacts.read');
    const params = new URLSearchParams({
      query,
      pageSize: maxResults,
      readMask: 'names,emailAddresses,phoneNumbers,organizations',
    });
    const response = await fetchWithTimeout(
      `https://people.googleapis.com/v1/people:searchContacts?${params.toString()}`,
      {
        timeoutMs: 10_000,
        headers: { authorization: `Bearer ${token}` },
      },
    );
    if (!response.ok) {
      throw new Error(`Google Contacts request failed with status ${response.status}`);
    }
    const body = (await response.json()) as { results?: { person?: ContactPerson }[] };
    const people = (body.results ?? []).map((result) => result.person).filter(Boolean);
    if (people.length === 0) {
      return 'No contacts matched the query.';
    }
    const lines = people.map((person, index) => {
      const name = person!.names?.[0]?.displayName ?? '(unnamed)';
      const email = person!.emailAddresses?.[0]?.value ?? '';
      const phone = person!.phoneNumbers?.[0]?.value ?? '';
      const org = person!.organizations?.[0];
      const orgLabel = org ? ` (${org.title ?? ''} @ ${org.name ?? ''})` : '';
      const details = [email, phone].filter(Boolean).join(' | ');
      return `${index + 1}. ${name}${orgLabel}${details ? ` — ${details}` : ''}`;
    });
    return lines.join('\n');
  },
};

import { requireProviderToken } from '../integrations/access.js';
import type { Tool } from './types.js';

type GmailMessageHeader = { name?: string; value?: string };

type GmailMessage = {
  id?: string;
  snippet?: string;
  payload?: { headers?: GmailMessageHeader[] };
};

type FetchInit = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
};

async function gmailRequest(token: string, path: string, init: FetchInit = {}): Promise<Response> {
  return fetch(`https://gmail.googleapis.com/gmail/v1${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
}

function headerValue(message: GmailMessage, name: string): string {
  const headers = message.payload?.headers ?? [];
  return headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? '';
}

export const gmailSearchTool: Tool = {
  name: 'gmail_search',
  description:
    'Search the user\u2019s Gmail inbox and return the matching messages with sender, subject, and snippet.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Gmail search query, e.g. "from:acme subject:invoice" or "unread".',
      },
      maxResults: {
        type: 'string',
        description: 'Maximum number of messages to return (default 5).',
      },
    },
    required: ['query'],
  },
  async execute(args, context) {
    const query = typeof args.query === 'string' ? args.query.trim() : '';
    if (!query) {
      throw new Error('Missing "query" argument');
    }
    const token = await requireProviderToken(context.userId, 'google-gmail');
    const maxResults = typeof args.maxResults === 'string' ? args.maxResults : '5';
    const searchParams = new URLSearchParams({
      q: query,
      maxResults,
    });
    const listResponse = await gmailRequest(token, `/users/me/messages?${searchParams.toString()}`);
    if (!listResponse.ok) {
      throw new Error(`Gmail request failed with status ${listResponse.status}`);
    }
    const listBody = (await listResponse.json()) as { messages?: { id?: string }[] };
    const messages = listBody.messages ?? [];
    if (messages.length === 0) {
      return 'No messages matched the query.';
    }

    const results: string[] = [];
    for (const message of messages) {
      if (!message.id) {
        continue;
      }
      const detailResponse = await gmailRequest(
        token,
        `/users/me/messages/${message.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
      );
      if (!detailResponse.ok) {
        continue;
      }
      const detail = (await detailResponse.json()) as GmailMessage;
      results.push(
        `- From: ${headerValue(detail, 'From')} | Subject: ${headerValue(detail, 'Subject')} | ${headerValue(detail, 'Date')}\n  ${detail.snippet ?? ''}`,
      );
    }
    return results.length > 0
      ? `Messages:\n${results.join('\n')}`
      : 'No messages matched the query.';
  },
};

export const gmailSendTool: Tool = {
  name: 'gmail_send',
  description:
    'Send an email from the user\u2019s Gmail account to one or more recipients with a subject and body.',
  parameters: {
    type: 'object',
    properties: {
      to: { type: 'string', description: 'Recipient email address(es), comma-separated.' },
      subject: { type: 'string', description: 'Email subject.' },
      body: { type: 'string', description: 'Email body text.' },
      cc: { type: 'string', description: 'Optional CC recipient(s), comma-separated.' },
    },
    required: ['to', 'subject', 'body'],
  },
  async execute(args, context) {
    const to = typeof args.to === 'string' ? args.to.trim() : '';
    const subject = typeof args.subject === 'string' ? args.subject.trim() : '';
    const body = typeof args.body === 'string' ? args.body.trim() : '';
    if (!to || !subject || !body) {
      throw new Error('Missing "to", "subject", or "body" argument');
    }
    const cc = typeof args.cc === 'string' ? args.cc.trim() : '';
    const token = await requireProviderToken(context.userId, 'google-gmail');

    const headers = [`To: ${to}`, `Subject: ${subject}`];
    if (cc) {
      headers.push(`Cc: ${cc}`);
    }
    headers.push('Content-Type: text/plain; charset=UTF-8', 'MIME-Version: 1.0', '', body);

    const raw = Buffer.from(headers.join('\r\n'), 'utf8').toString('base64url');
    const response = await gmailRequest(token, '/users/me/messages/send', {
      method: 'POST',
      body: JSON.stringify({ raw }),
    });
    if (!response.ok) {
      throw new Error(`Gmail request failed with status ${response.status}`);
    }
    const sent = (await response.json()) as GmailMessage;
    return `Email sent to ${to} (message id: ${sent.id ?? 'unknown'})`;
  },
};

import { requirePermission } from '../integrations/access.js';
import type { Tool } from './types.js';
import { fetchWithTimeout } from '../lib/http.js';

type GmailMessageHeader = { name?: string; value?: string };

type GmailMessage = {
  id?: string;
  threadId?: string;
  snippet?: string;
  labelIds?: string[];
  payload?: { headers?: GmailMessageHeader[] };
};

type GmailMessagePart = {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailMessagePart[];
  headers?: GmailMessageHeader[];
};

type GmailLabel = {
  id?: string;
  name?: string;
  type?: string;
};

type GmailThread = {
  id?: string;
  messages?: GmailMessage[];
};

type FetchInit = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
};

function decodeBase64(data: string): string {
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

function extractTextPart(part: GmailMessagePart): string {
  const text = decodeBase64(part.body?.data ?? '');
  if (text) {
    return text;
  }
  return (part.parts ?? []).map(extractTextPart).join('\n');
}

async function gmailRequest(token: string, path: string, init: FetchInit = {}): Promise<Response> {
  return fetchWithTimeout(`https://gmail.googleapis.com/gmail/v1${path}`, {
    ...init,
    timeoutMs: 10_000,
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

function buildReplyRaw(
  to: string,
  subject: string,
  body: string,
  inReplyTo: string,
  threadId?: string,
): string {
  const headers = [
    `To: ${to}`,
    `Subject: ${subject}`,
    `In-Reply-To: ${inReplyTo}`,
    `References: ${inReplyTo}`,
    'Content-Type: text/plain; charset=UTF-8',
    'MIME-Version: 1.0',
    '',
    body,
  ];
  const raw = Buffer.from(headers.join('\r\n'), 'utf8').toString('base64url');
  return JSON.stringify({ raw, threadId });
}

function buildForwardRaw(to: string, subject: string, body: string, threadId?: string): string {
  const headers = [
    `To: ${to}`,
    `Subject: Fwd: ${subject.replace(/^Fwd:\s*/i, '')}`,
    'Content-Type: text/plain; charset=UTF-8',
    'MIME-Version: 1.0',
    '',
    body,
  ];
  const raw = Buffer.from(headers.join('\r\n'), 'utf8').toString('base64url');
  return JSON.stringify({ raw, threadId });
}

export const gmailSearchTool: Tool = {
  name: 'gmail_search',
  providerId: 'google-gmail',
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
    const token = await requirePermission(context.userId, 'google-gmail', 'gmail.read');
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

export const gmailReadTool: Tool = {
  name: 'gmail_read',
  providerId: 'google-gmail',
  description:
    'Read a single Gmail message by its ID and return its sender, recipients, subject, date, and text body.',
  parameters: {
    type: 'object',
    properties: {
      messageId: {
        type: 'string',
        description: 'Gmail message ID (from gmail_search).',
      },
    },
    required: ['messageId'],
  },
  async execute(args, context) {
    const messageId = typeof args.messageId === 'string' ? args.messageId.trim() : '';
    if (!messageId) {
      throw new Error('Missing "messageId" argument');
    }
    const token = await requirePermission(context.userId, 'google-gmail', 'gmail.read');
    const response = await gmailRequest(
      token,
      `/users/me/messages/${encodeURIComponent(messageId)}?format=full`,
    );
    if (!response.ok) {
      throw new Error(`Gmail request failed with status ${response.status}`);
    }
    const message = (await response.json()) as { payload?: GmailMessagePart };
    const payload = message.payload ?? {};
    const headers = payload.headers ?? [];
    const findHeader = (name: string): string =>
      headers.find((header) => header.name?.toLowerCase() === name.toLowerCase())?.value ?? '';
    const body = extractTextPart(payload).trim();
    const lines = [
      `From: ${findHeader('From')}`,
      `To: ${findHeader('To')}`,
      `Subject: ${findHeader('Subject')}`,
      `Date: ${findHeader('Date')}`,
      '',
      body || '(no text body)',
    ];
    return lines.join('\n');
  },
};

export const gmailSendTool: Tool = {
  name: 'gmail_send',
  providerId: 'google-gmail',
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
    const token = await requirePermission(context.userId, 'google-gmail', 'gmail.send');

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

export const gmailReplyTool: Tool = {
  name: 'gmail_reply',
  providerId: 'google-gmail',
  description: 'Reply to a Gmail message. The reply is sent in the same thread.',
  parameters: {
    type: 'object',
    properties: {
      messageId: {
        type: 'string',
        description: 'The Gmail message ID to reply to.',
      },
      body: { type: 'string', description: 'Reply body text.' },
      replyAll: {
        type: 'string',
        description: 'Set to "true" to reply to all recipients (default: reply to sender only).',
      },
    },
    required: ['messageId', 'body'],
  },
  async execute(args, context) {
    const messageId = typeof args.messageId === 'string' ? args.messageId.trim() : '';
    const body = typeof args.body === 'string' ? args.body.trim() : '';
    if (!messageId || !body) {
      throw new Error('Missing "messageId" or "body" argument');
    }
    const token = await requirePermission(context.userId, 'google-gmail', 'gmail.send');

    const msgResponse = await gmailRequest(
      token,
      `/users/me/messages/${encodeURIComponent(messageId)}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject`,
    );
    if (!msgResponse.ok) {
      throw new Error(`Failed to fetch message: ${msgResponse.status}`);
    }
    const msg = (await msgResponse.json()) as GmailMessage;
    const replyAll = args.replyAll === 'true';
    const to = replyAll
      ? headerValue(msg, 'To') || headerValue(msg, 'From')
      : headerValue(msg, 'From');
    const subject = headerValue(msg, 'Subject');
    const messageRef = headerValue(msg, 'Message-ID') || `<${messageId}@mail.gmail.com>`;
    const rawPayload = buildReplyRaw(to, subject, body, messageRef, msg.threadId);
    const response = await gmailRequest(token, '/users/me/messages/send', {
      method: 'POST',
      body: rawPayload,
    });
    if (!response.ok) {
      throw new Error(`Gmail request failed with status ${response.status}`);
    }
    const sent = (await response.json()) as GmailMessage;
    return `Reply sent to ${to} (message id: ${sent.id ?? 'unknown'})`;
  },
};

export const gmailForwardTool: Tool = {
  name: 'gmail_forward',
  providerId: 'google-gmail',
  description: 'Forward a Gmail message to another recipient.',
  parameters: {
    type: 'object',
    properties: {
      messageId: {
        type: 'string',
        description: 'The Gmail message ID to forward.',
      },
      to: { type: 'string', description: 'Recipient email address to forward to.' },
      body: {
        type: 'string',
        description: 'Optional additional text to include with the forwarded message.',
      },
    },
    required: ['messageId', 'to'],
  },
  async execute(args, context) {
    const messageId = typeof args.messageId === 'string' ? args.messageId.trim() : '';
    const to = typeof args.to === 'string' ? args.to.trim() : '';
    if (!messageId || !to) {
      throw new Error('Missing "messageId" or "to" argument');
    }
    const token = await requirePermission(context.userId, 'google-gmail', 'gmail.send');

    const msgResponse = await gmailRequest(
      token,
      `/users/me/messages/${encodeURIComponent(messageId)}?format=full`,
    );
    if (!msgResponse.ok) {
      throw new Error(`Failed to fetch message: ${msgResponse.status}`);
    }
    const msg = (await msgResponse.json()) as GmailMessage;
    const subject = headerValue(msg, 'Subject') || '(no subject)';
    const from = headerValue(msg, 'From');
    const date = headerValue(msg, 'Date');
    const textBody = extractTextPart(msg.payload ?? {}).trim();
    const extra = typeof args.body === 'string' ? args.body.trim() : '';
    const forwardBody = [
      extra
        ? `${extra}\n\n---------- Forwarded message ----------`
        : '---------- Forwarded message ----------',
      `From: ${from}`,
      `Date: ${date}`,
      `Subject: ${subject}`,
      '',
      textBody,
    ].join('\n');
    const rawPayload = buildForwardRaw(to, subject, forwardBody, msg.threadId);
    const response = await gmailRequest(token, '/users/me/messages/send', {
      method: 'POST',
      body: rawPayload,
    });
    if (!response.ok) {
      throw new Error(`Gmail request failed with status ${response.status}`);
    }
    const sent = (await response.json()) as GmailMessage;
    return `Forwarded to ${to} (message id: ${sent.id ?? 'unknown'})`;
  },
};

export const gmailListLabelsTool: Tool = {
  name: 'gmail_list_labels',
  providerId: 'google-gmail',
  description: 'List all Gmail labels in the user\u2019s account with their IDs and names.',
  parameters: {
    type: 'object',
    properties: {},
  },
  async execute(_args, context) {
    const token = await requirePermission(context.userId, 'google-gmail', 'gmail.read');
    const response = await gmailRequest(token, '/users/me/labels');
    if (!response.ok) {
      throw new Error(`Gmail request failed with status ${response.status}`);
    }
    const body = (await response.json()) as { labels?: GmailLabel[] };
    const labels = body.labels ?? [];
    if (labels.length === 0) {
      return 'No labels found.';
    }
    const lines = labels.map(
      (label, index) =>
        `${index + 1}. ${label.name ?? '(unnamed)'} (id: ${label.id ?? 'unknown'}, type: ${label.type ?? 'user'})`,
    );
    return lines.join('\n');
  },
};

export const gmailReadThreadTool: Tool = {
  name: 'gmail_read_thread',
  providerId: 'google-gmail',
  description: 'Read all messages in a Gmail thread and return the conversation.',
  parameters: {
    type: 'object',
    properties: {
      threadId: {
        type: 'string',
        description: 'The Gmail thread ID.',
      },
    },
    required: ['threadId'],
  },
  async execute(args, context) {
    const threadId = typeof args.threadId === 'string' ? args.threadId.trim() : '';
    if (!threadId) {
      throw new Error('Missing "threadId" argument');
    }
    const token = await requirePermission(context.userId, 'google-gmail', 'gmail.read');
    const response = await gmailRequest(
      token,
      `/users/me/threads/${encodeURIComponent(threadId)}?format=full`,
    );
    if (!response.ok) {
      throw new Error(`Gmail request failed with status ${response.status}`);
    }
    const thread = (await response.json()) as GmailThread;
    const messages = thread.messages ?? [];
    if (messages.length === 0) {
      return 'Thread is empty.';
    }
    const parts = messages.map((msg, index) => {
      const from = headerValue(msg, 'From');
      const to = headerValue(msg, 'To');
      const subject = headerValue(msg, 'Subject');
      const date = headerValue(msg, 'Date');
      const body = extractTextPart(msg.payload ?? {}).trim();
      return [
        `--- Message ${index + 1} ---`,
        `From: ${from}`,
        `To: ${to}`,
        `Date: ${date}`,
        `Subject: ${subject}`,
        '',
        body || '(no text body)',
      ].join('\n');
    });
    return parts.join('\n\n');
  },
};

export const gmailModifyTool: Tool = {
  name: 'gmail_modify',
  providerId: 'google-gmail',
  description:
    'Modify a Gmail message: add or remove labels (e.g. mark as read, unread, star, archive).',
  parameters: {
    type: 'object',
    properties: {
      messageId: {
        type: 'string',
        description: 'The Gmail message ID to modify.',
      },
      addLabelIds: {
        type: 'string',
        description: 'Comma-separated label IDs to add (e.g. "STARRED", "UNREAD").',
      },
      removeLabelIds: {
        type: 'string',
        description: 'Comma-separated label IDs to remove (e.g. "UNREAD", "INBOX").',
      },
    },
    required: ['messageId'],
  },
  async execute(args, context) {
    const messageId = typeof args.messageId === 'string' ? args.messageId.trim() : '';
    if (!messageId) {
      throw new Error('Missing "messageId" argument');
    }
    const addLabelIds =
      typeof args.addLabelIds === 'string' && args.addLabelIds.trim()
        ? args.addLabelIds
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : [];
    const removeLabelIds =
      typeof args.removeLabelIds === 'string' && args.removeLabelIds.trim()
        ? args.removeLabelIds
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : [];
    if (addLabelIds.length === 0 && removeLabelIds.length === 0) {
      throw new Error('Provide at least one of "addLabelIds" or "removeLabelIds"');
    }
    const token = await requirePermission(context.userId, 'google-gmail', 'gmail.modify');
    const response = await gmailRequest(
      token,
      `/users/me/messages/${encodeURIComponent(messageId)}/modify`,
      {
        method: 'POST',
        body: JSON.stringify({ addLabelIds, removeLabelIds }),
      },
    );
    if (!response.ok) {
      throw new Error(`Gmail request failed with status ${response.status}`);
    }
    const actions: string[] = [];
    if (addLabelIds.length > 0) actions.push(`added labels [${addLabelIds.join(', ')}]`);
    if (removeLabelIds.length > 0) actions.push(`removed labels [${removeLabelIds.join(', ')}]`);
    return `Message ${messageId} updated: ${actions.join(', ')}`;
  },
};

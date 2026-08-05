import { requirePermission } from '../integrations/access.js';
import type { Tool } from './types.js';
import { fetchWithTimeout } from '../lib/http.js';

const SLACK_API = 'https://slack.com/api';

type SlackChannel = {
  id?: string;
  name?: string;
  is_archived?: boolean;
  num_members?: number;
  topic?: { value?: string };
  purpose?: { value?: string };
};

type SlackMessage = {
  user?: string;
  text?: string;
  ts?: string;
  thread_ts?: string;
  reply_count?: number;
  subtype?: string;
  bot_id?: string;
};

type SlackUserProfile = {
  real_name?: string;
  display_name?: string;
  email?: string;
  status_text?: string;
  status_emoji?: string;
  status_expiration?: number;
};

type SlackMember = {
  id?: string;
  name?: string;
  real_name?: string;
  is_bot?: boolean;
  is_admin?: boolean;
  profile?: SlackUserProfile;
};

async function slackCall<T>(
  token: string,
  method: string,
  params: Record<string, string>,
): Promise<T> {
  const response = await fetchWithTimeout(`${SLACK_API}/${method}`, {
    method: 'POST',
    timeoutMs: 10_000,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(params).toString(),
  });
  if (!response.ok) {
    throw new Error(`Slack request failed with status ${response.status}`);
  }
  const body = (await response.json()) as { ok?: boolean; error?: string } & T;
  if (!body.ok) {
    throw new Error(`Slack error: ${body.error ?? 'unknown error'}`);
  }
  return body;
}

function parseLimit(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(typeof value === 'string' ? value : '', 10);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 200) : fallback;
}

function formatMember(member: SlackMember): string {
  const handle = member.name ? `@${member.name}` : (member.id ?? '(unknown)');
  const realName = member.profile?.real_name ?? member.real_name ?? '';
  const email = member.profile?.email ? ` — ${member.profile.email}` : '';
  const kind = member.is_bot ? 'bot' : member.is_admin ? 'admin' : 'member';
  const status =
    member.profile?.status_text || member.profile?.status_emoji
      ? ` | status: ${member.profile.status_emoji ?? ''} ${member.profile.status_text ?? ''}`.trim()
      : '';
  return `- ${handle}${realName ? ` (${realName})` : ''}${email} | ${kind}${status}`;
}

export const slackSendMessageTool: Tool = {
  name: 'slack_send_message',
  description:
    'Send a message to a Slack channel or direct message. Provide the channel, e.g. "#general" or a user ID, and the text. Optionally reply inside a thread.',
  parameters: {
    type: 'object',
    properties: {
      channel: {
        type: 'string',
        description: 'Channel to post to, e.g. "#general" or "@username" (or a channel ID).',
      },
      text: { type: 'string', description: 'Message text.' },
      threadTs: {
        type: 'string',
        description: 'Optional parent message timestamp to reply inside a thread.',
      },
    },
    required: ['channel', 'text'],
  },
  async execute(args, context) {
    const channel = typeof args.channel === 'string' ? args.channel.trim() : '';
    const text = typeof args.text === 'string' ? args.text.trim() : '';
    if (!channel || !text) {
      throw new Error('Missing "channel" or "text" argument');
    }
    const threadTs = typeof args.threadTs === 'string' ? args.threadTs.trim() : '';
    const token = await requirePermission(context.userId, 'slack', 'slack.send');
    const body = await slackCall<{ channel?: string; ts?: string }>(token, 'chat.postMessage', {
      channel,
      text,
      ...(threadTs ? { thread_ts: threadTs } : {}),
    });
    return `Message sent to ${body.channel ?? channel} (ts: ${body.ts ?? 'unknown'})`;
  },
};

export const slackListChannelsTool: Tool = {
  name: 'slack_list_channels',
  description:
    'List the public channels in the user\u2019s Slack workspace with their member counts and topics.',
  parameters: {
    type: 'object',
    properties: {
      limit: {
        type: 'string',
        description: 'Maximum number of channels to return (default 20, max 200).',
      },
    },
  },
  async execute(args, context) {
    const token = await requirePermission(context.userId, 'slack', 'slack.channels');
    const limit = parseLimit(args.limit, 20);
    const body = await slackCall<{ channels?: SlackChannel[] }>(token, 'conversations.list', {
      types: 'public_channel',
      exclude_archived: 'true',
      limit: String(limit),
    });
    const channels = body.channels ?? [];
    if (channels.length === 0) {
      return 'No channels found.';
    }
    const lines = channels.map((channel, index) => {
      const topic = channel.topic?.value ? ` — ${channel.topic.value}` : '';
      return `${index + 1}. #${channel.name ?? '(unnamed)'} (${channel.id ?? '?'}) | members: ${channel.num_members ?? 0}${topic}`;
    });
    return lines.join('\n');
  },
};

export const slackReadMessagesTool: Tool = {
  name: 'slack_read_messages',
  description:
    'Read the most recent messages from a Slack channel, optionally only messages posted after a given time.',
  parameters: {
    type: 'object',
    properties: {
      channel: {
        type: 'string',
        description: 'Channel ID or name, e.g. "#general".',
      },
      limit: {
        type: 'string',
        description: 'Maximum number of messages to return (default 10, max 200).',
      },
      oldest: {
        type: 'string',
        description:
          'Optional ISO timestamp (e.g. "2026-08-01T00:00:00Z") to only show newer messages.',
      },
    },
    required: ['channel'],
  },
  async execute(args, context) {
    const channel = typeof args.channel === 'string' ? args.channel.trim() : '';
    if (!channel) {
      throw new Error('Missing "channel" argument');
    }
    const token = await requirePermission(context.userId, 'slack', 'slack.messages');
    const limit = parseLimit(args.limit, 10);
    const params: Record<string, string> = { channel, limit: String(limit) };
    if (typeof args.oldest === 'string' && args.oldest.trim()) {
      const raw = args.oldest.trim();
      const parsed = Number.isFinite(Number(raw)) ? Number(raw) : Date.parse(raw);
      if (Number.isFinite(parsed) && parsed > 0) {
        params.oldest = String(parsed > 1e12 ? Math.floor(parsed / 1000) : parsed);
      }
    }
    const body = await slackCall<{ messages?: SlackMessage[] }>(
      token,
      'conversations.history',
      params,
    );
    const messages = body.messages ?? [];
    if (messages.length === 0) {
      return `No messages found in ${channel}.`;
    }
    const lines = messages.map((message) => {
      const thread =
        message.reply_count && message.reply_count > 0
          ? ` (thread: ${message.reply_count} replies)`
          : '';
      const sender = message.user ?? message.bot_id ?? 'system';
      return `- ${message.ts ?? ''} ${sender}: ${message.text ?? '(no text)'}${thread}`;
    });
    return `Messages in ${channel}:\n${lines.join('\n')}`;
  },
};

export const slackListUsersTool: Tool = {
  name: 'slack_list_users',
  description:
    'List the members of the user\u2019s Slack workspace with their name, email, and current status.',
  parameters: {
    type: 'object',
    properties: {
      limit: {
        type: 'string',
        description: 'Maximum number of users to return (default 20, max 200).',
      },
    },
  },
  async execute(args, context) {
    const token = await requirePermission(context.userId, 'slack', 'slack.users');
    const limit = parseLimit(args.limit, 20);
    const body = await slackCall<{ members?: SlackMember[] }>(token, 'users.list', {
      limit: String(limit),
    });
    const members = (body.members ?? []).filter((member) => !member.is_bot);
    if (members.length === 0) {
      return 'No users found.';
    }
    return members.map(formatMember).join('\n');
  },
};

export const slackReadThreadTool: Tool = {
  name: 'slack_read_thread',
  description: 'Read a Slack thread: the parent message and its replies in a channel.',
  parameters: {
    type: 'object',
    properties: {
      channel: {
        type: 'string',
        description: 'Channel ID or name containing the thread.',
      },
      threadTs: {
        type: 'string',
        description: 'Timestamp of the parent message (the thread root), e.g. "1234567890.123456".',
      },
      limit: {
        type: 'string',
        description: 'Maximum number of replies to return (default 10, max 200).',
      },
    },
    required: ['channel', 'threadTs'],
  },
  async execute(args, context) {
    const channel = typeof args.channel === 'string' ? args.channel.trim() : '';
    const threadTs = typeof args.threadTs === 'string' ? args.threadTs.trim() : '';
    if (!channel || !threadTs) {
      throw new Error('Missing "channel" or "threadTs" argument');
    }
    const token = await requirePermission(context.userId, 'slack', 'slack.threads');
    const limit = parseLimit(args.limit, 10);
    const body = await slackCall<{ messages?: SlackMessage[] }>(token, 'conversations.replies', {
      channel,
      ts: threadTs,
      limit: String(limit),
    });
    const messages = body.messages ?? [];
    if (messages.length === 0) {
      return `No replies found in ${channel} for ts ${threadTs}.`;
    }
    const lines = messages.map((message, index) => {
      const sender = message.user ?? message.bot_id ?? 'system';
      const text = message.text ?? '(no text)';
      return index === 0 ? `- ${sender}: ${text}` : `  ↳ ${sender}: ${text}`;
    });
    return `Thread in ${channel} (ts: ${threadTs}):\n${lines.join('\n')}`;
  },
};

export const slackGetStatusTool: Tool = {
  name: 'slack_get_status',
  description:
    'Show the current Slack status (status text, emoji, and expiry) of the authenticated user.',
  parameters: {
    type: 'object',
    properties: {},
  },
  async execute(_args, context) {
    const token = await requirePermission(context.userId, 'slack', 'slack.status');
    const auth = await slackCall<{ user_id?: string }>(token, 'auth.test', {});
    const userId = auth.user_id ?? '';
    const info = await slackCall<{ user?: SlackMember }>(token, 'users.info', { user: userId });
    const profile = info.user?.profile ?? {};
    const handle = (info.user?.name ?? userId) || 'unknown';
    const lines = [
      `Slack user: ${handle}`,
      `Display name: ${profile.display_name || profile.real_name || '(not set)'}`,
      `Email: ${profile.email ?? '(not set)'}`,
      `Status: ${profile.status_emoji ?? ''} ${profile.status_text || '(no status set)'}`.trim(),
    ];
    if (
      typeof profile.status_expiration === 'number' &&
      profile.status_expiration > Math.floor(Date.now() / 1000)
    ) {
      lines.push(`Status expires: ${new Date(profile.status_expiration * 1000).toISOString()}`);
    }
    return lines.join('\n');
  },
};

export const slackSetStatusTool: Tool = {
  name: 'slack_set_status',
  description:
    'Set the Slack status (text and emoji) for the authenticated user, optionally expiring after some minutes.',
  parameters: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'Status text, e.g. "In a meeting".' },
      emoji: {
        type: 'string',
        description: 'Status emoji, e.g. ":calendar:" (default :speech_balloon:).',
      },
      expiresInMinutes: {
        type: 'string',
        description: 'Optional number of minutes until the status clears itself.',
      },
    },
    required: ['text'],
  },
  async execute(args, context) {
    const text = typeof args.text === 'string' ? args.text.trim() : '';
    if (!text) {
      throw new Error('Missing "text" argument');
    }
    const token = await requirePermission(context.userId, 'slack', 'slack.status');
    const emoji =
      typeof args.emoji === 'string' && args.emoji.trim() ? args.emoji.trim() : ':speech_balloon:';
    const profile: { status_text: string; status_emoji: string; status_expiration?: number } = {
      status_text: text,
      status_emoji: emoji,
    };
    const parsed = Number.parseInt(
      typeof args.expiresInMinutes === 'string' ? args.expiresInMinutes : '',
      10,
    );
    const minutes = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    if (minutes > 0) {
      profile.status_expiration = Math.floor(Date.now() / 1000) + minutes * 60;
    }
    await slackCall(token, 'users.profile.set', { profile: JSON.stringify(profile) });
    return `Status set to ${emoji} ${text}${minutes > 0 ? ` (expires in ${minutes} minutes)` : ''}`;
  },
};

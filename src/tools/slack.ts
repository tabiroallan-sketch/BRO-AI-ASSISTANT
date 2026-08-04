import { requireProviderToken } from '../integrations/access.js';
import type { Tool } from './types.js';
import { fetchWithTimeout } from '../lib/http.js';

export const slackSendMessageTool: Tool = {
  name: 'slack_send_message',
  description:
    'Send a message to a Slack channel or direct message. Provide the channel, e.g. "#general" or a user ID, and the text.',
  parameters: {
    type: 'object',
    properties: {
      channel: {
        type: 'string',
        description: 'Channel to post to, e.g. "#general" or "@username" (or a channel ID).',
      },
      text: { type: 'string', description: 'Message text.' },
    },
    required: ['channel', 'text'],
  },
  async execute(args, context) {
    const channel = typeof args.channel === 'string' ? args.channel.trim() : '';
    const text = typeof args.text === 'string' ? args.text.trim() : '';
    if (!channel || !text) {
      throw new Error('Missing "channel" or "text" argument');
    }
    const token = await requireProviderToken(context.userId, 'slack');
    const response = await fetchWithTimeout('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      timeoutMs: 10_000,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ channel, text }),
    });
    if (!response.ok) {
      throw new Error(`Slack request failed with status ${response.status}`);
    }
    const body = (await response.json()) as { ok?: boolean; error?: string; ts?: string };
    if (!body.ok) {
      throw new Error(`Slack error: ${body.error ?? 'unknown error'}`);
    }
    return `Message sent to ${channel} (ts: ${body.ts ?? 'unknown'})`;
  },
};

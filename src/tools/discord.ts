import { getIntegrationRecord } from '../integrations/access.js';
import type { Tool } from './types.js';
import { fetchWithTimeout } from '../lib/http.js';

export const discordSendMessageTool: Tool = {
  name: 'discord_send_message',
  description: 'Send a message to a Discord channel using the user\u2019s configured webhook.',
  parameters: {
    type: 'object',
    properties: {
      content: { type: 'string', description: 'Message content.' },
    },
    required: ['content'],
  },
  async execute(args, context) {
    const content = typeof args.content === 'string' ? args.content.trim() : '';
    if (!content) {
      throw new Error('Missing "content" argument');
    }
    const { token: webhookUrl } = await getIntegrationRecord(context.userId, 'discord');
    const response = await fetchWithTimeout(`${webhookUrl}?wait=true`, {
      method: 'POST',
      timeoutMs: 10_000,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    if (!response.ok) {
      throw new Error(`Discord request failed with status ${response.status}`);
    }
    return `Message sent to Discord (id: ${((await response.json()) as { id?: string }).id ?? 'unknown'})`;
  },
};

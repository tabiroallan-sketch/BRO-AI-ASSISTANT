import { fetchWithTimeout } from '../../../lib/http.js';
import type { WebhookProviderDef } from '../../types.js';

export const discordProvider: WebhookProviderDef = {
  id: 'discord',
  label: 'Discord',
  description: 'Send messages to a Discord channel via webhook.',
  type: 'webhook',
  icon: 'discord',
  oauthConfigured: true,
  capabilities: ['discord:send'],
  permissions: [
    {
      id: 'discord.send',
      label: 'Post Messages',
      description: 'Post messages to a Discord channel.',
      scope: '',
      capability: 'discord:send',
    },
  ],
  async healthCheck(token) {
    try {
      const response = await fetchWithTimeout(token, { timeoutMs: 10_000 });
      if (!response.ok) {
        return { ok: false, message: `Webhook check failed with status ${response.status}` };
      }
      const body = (await response.json()) as { name?: string };
      return { ok: true, accountName: body.name ?? 'Discord webhook' };
    } catch {
      return { ok: false, message: 'Webhook check failed' };
    }
  },
};

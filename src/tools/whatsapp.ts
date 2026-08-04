import { config } from '../config/index.js';
import { getIntegrationRecord } from '../integrations/access.js';
import type { Tool } from './types.js';
import { fetchWithTimeout } from '../lib/http.js';

export const whatsappSendMessageTool: Tool = {
  name: 'whatsapp_send_message',
  description:
    'Send a WhatsApp message to a phone number using the user\u2019s WhatsApp Business API credentials. The recipient number must be in E.164 format, e.g. "+15551234567".',
  parameters: {
    type: 'object',
    properties: {
      to: {
        type: 'string',
        description: 'Recipient phone number in E.164 format, e.g. "+15551234567".',
      },
      body: { type: 'string', description: 'Message text.' },
    },
    required: ['to', 'body'],
  },
  async execute(args, context) {
    const to = typeof args.to === 'string' ? args.to.trim() : '';
    const body = typeof args.body === 'string' ? args.body.trim() : '';
    if (!to || !body) {
      throw new Error('Missing "to" or "body" argument');
    }
    const { token, metadata } = await getIntegrationRecord(context.userId, 'whatsapp');
    const phoneNumberId = typeof metadata.phoneNumberId === 'string' ? metadata.phoneNumberId : '';
    if (!phoneNumberId) {
      throw new Error('WhatsApp phone number ID is missing. Reconnect WhatsApp in Settings.');
    }
    const response = await fetchWithTimeout(`${config.whatsappApiUrl}/${phoneNumberId}/messages`, {
      method: 'POST',
      timeoutMs: 10_000,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body },
      }),
    });
    if (!response.ok) {
      throw new Error(`WhatsApp request failed with status ${response.status}`);
    }
    const result = (await response.json()) as { messages?: { id?: string }[] };
    const messageId = result.messages?.[0]?.id;
    return `WhatsApp message sent to ${to} (id: ${messageId ?? 'unknown'})`;
  },
};

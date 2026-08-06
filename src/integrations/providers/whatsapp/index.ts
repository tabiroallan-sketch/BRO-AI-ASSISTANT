import { fetchWithTimeout } from '../../../lib/http.js';
import type { TokenProviderDef } from '../../types.js';

export const whatsappProvider: TokenProviderDef = {
  id: 'whatsapp',
  label: 'WhatsApp',
  description: 'Send messages via the WhatsApp Business API.',
  type: 'token',
  icon: 'whatsapp',
  oauthConfigured: true,
  capabilities: ['whatsapp:send'],
  permissions: [
    {
      id: 'whatsapp.send',
      label: 'Send Messages',
      description: 'Send messages via the WhatsApp Business API.',
      scope: '',
      capability: 'whatsapp:send',
    },
  ],
  fields: [
    {
      name: 'token',
      label: 'Access token',
      placeholder: 'Permanent WhatsApp Business API token',
    },
    { name: 'phoneNumberId', label: 'Phone number ID', placeholder: 'e.g. 123456789012345' },
  ],
  accountNameFromFields: (values) =>
    typeof values.phoneNumberId === 'string' && values.phoneNumberId.trim() !== ''
      ? `Phone ${values.phoneNumberId}`
      : null,
  async healthCheck(token, metadata) {
    const phoneNumberId = typeof metadata.phoneNumberId === 'string' ? metadata.phoneNumberId : '';
    if (!phoneNumberId) {
      return { ok: false, message: 'Missing phone number ID' };
    }
    try {
      const response = await fetchWithTimeout(`https://graph.facebook.com/v18.0/${phoneNumberId}`, {
        timeoutMs: 10_000,
        headers: { authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        return { ok: false, message: `WhatsApp check failed with status ${response.status}` };
      }
      const body = (await response.json()) as { display_phone_number?: string };
      return { ok: true, accountName: body.display_phone_number ?? 'WhatsApp' };
    } catch {
      return { ok: false, message: 'WhatsApp check failed' };
    }
  },
};

import { fetchWithTimeout } from '../../../lib/http.js';
import type { TokenProviderDef } from '../../types.js';

async function geminiHealthCheck(apiKey: string): Promise<{ ok: boolean; message?: string }> {
  const response = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
    { timeoutMs: 10_000 },
  );
  if (!response.ok) {
    return { ok: false, message: `Gemini check failed with status ${response.status}` };
  }
  return { ok: true };
}

export const geminiProvider: TokenProviderDef = {
  id: 'gemini',
  label: 'Gemini',
  description: 'Google Gemini models for chat and content generation.',
  type: 'token',
  icon: 'gemini',
  oauthConfigured: true,
  capabilities: ['gemini:chat', 'gemini:generate'],
  permissions: [
    {
      id: 'gemini.chat',
      label: 'Chat',
      description: 'Generate chat responses with Gemini models.',
      scope: '',
      capability: 'gemini:chat',
    },
    {
      id: 'gemini.generate',
      label: 'Content Generation',
      description: 'Generate text content with Gemini models.',
      scope: '',
      capability: 'gemini:generate',
    },
  ],
  fields: [
    {
      name: 'apiKey',
      label: 'API key',
      placeholder: 'AIza…',
    },
  ],
  async healthCheck(apiKey) {
    const result = await geminiHealthCheck(apiKey);
    return { ok: result.ok, accountName: result.ok ? 'Gemini' : null, message: result.message };
  },
};

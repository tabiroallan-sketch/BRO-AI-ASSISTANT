import { fetchWithTimeout } from '../../../lib/http.js';
import type { TokenProviderDef } from '../../types.js';

async function openaiHealthCheck(apiKey: string): Promise<{ ok: boolean; message?: string }> {
  const response = await fetchWithTimeout('https://api.openai.com/v1/models', {
    timeoutMs: 10_000,
    headers: { authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) {
    return { ok: false, message: `OpenAI check failed with status ${response.status}` };
  }
  return { ok: true };
}

export const openaiProvider: TokenProviderDef = {
  id: 'openai',
  label: 'OpenAI',
  description: 'Chat completions, models, and assistants.',
  type: 'token',
  icon: 'openai',
  oauthConfigured: true,
  capabilities: ['openai:chat', 'openai:models'],
  permissions: [
    {
      id: 'openai.chat',
      label: 'Chat Completions',
      description: 'Generate chat completions with OpenAI models.',
      scope: '',
      capability: 'openai:chat',
    },
    {
      id: 'openai.models',
      label: 'Models',
      description: 'List the OpenAI models available to your key.',
      scope: '',
      capability: 'openai:models',
    },
  ],
  fields: [
    {
      name: 'apiKey',
      label: 'API key',
      placeholder: 'sk-…',
    },
  ],
  async healthCheck(apiKey) {
    const result = await openaiHealthCheck(apiKey);
    return { ok: result.ok, accountName: result.ok ? 'OpenAI' : null, message: result.message };
  },
};

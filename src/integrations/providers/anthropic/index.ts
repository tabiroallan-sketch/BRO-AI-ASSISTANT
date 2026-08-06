import { fetchWithTimeout } from '../../../lib/http.js';
import type { TokenProviderDef } from '../../types.js';

async function anthropicHealthCheck(apiKey: string): Promise<{ ok: boolean; message?: string }> {
  const response = await fetchWithTimeout('https://api.anthropic.com/v1/models', {
    timeoutMs: 10_000,
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
  });
  if (!response.ok) {
    return { ok: false, message: `Anthropic check failed with status ${response.status}` };
  }
  return { ok: true };
}

export const anthropicProvider: TokenProviderDef = {
  id: 'anthropic',
  label: 'Anthropic',
  description: 'Claude models for chat and text generation.',
  type: 'token',
  icon: 'anthropic',
  oauthConfigured: true,
  capabilities: ['anthropic:chat', 'anthropic:models'],
  permissions: [
    {
      id: 'anthropic.chat',
      label: 'Chat',
      description: 'Generate chat responses with Claude models.',
      scope: '',
      capability: 'anthropic:chat',
    },
    {
      id: 'anthropic.models',
      label: 'Models',
      description: 'List the Claude models available to your key.',
      scope: '',
      capability: 'anthropic:models',
    },
  ],
  fields: [
    {
      name: 'apiKey',
      label: 'API key',
      placeholder: 'sk-ant-…',
    },
  ],
  async healthCheck(apiKey) {
    const result = await anthropicHealthCheck(apiKey);
    return { ok: result.ok, accountName: result.ok ? 'Anthropic' : null, message: result.message };
  },
};

import { fetchWithTimeout } from '../../../lib/http.js';
import type { TokenProviderDef } from '../../types.js';

async function nvidiaHealthCheck(apiKey: string): Promise<{ ok: boolean; message?: string }> {
  const response = await fetchWithTimeout('https://integrate.api.nvidia.com/v1/models', {
    timeoutMs: 10_000,
    headers: { authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) {
    return { ok: false, message: `NVIDIA check failed with status ${response.status}` };
  }
  return { ok: true };
}

export const nvidiaProvider: TokenProviderDef = {
  id: 'nvidia',
  label: 'NVIDIA',
  description: 'NVIDIA NIM models, chat completions, and inference APIs.',
  type: 'token',
  icon: 'nvidia',
  oauthConfigured: true,
  capabilities: ['nvidia:chat', 'nvidia:models'],
  permissions: [
    {
      id: 'nvidia.chat',
      label: 'Chat Completions',
      description: 'Generate chat completions with NVIDIA NIM models.',
      scope: '',
      capability: 'nvidia:chat',
    },
    {
      id: 'nvidia.models',
      label: 'Models',
      description: 'List the NVIDIA NIM models available to your key.',
      scope: '',
      capability: 'nvidia:models',
    },
  ],
  fields: [
    {
      name: 'apiKey',
      label: 'API key',
      placeholder: 'nvapi-…',
    },
  ],
  async healthCheck(apiKey) {
    const result = await nvidiaHealthCheck(apiKey);
    return { ok: result.ok, accountName: result.ok ? 'NVIDIA' : null, message: result.message };
  },
};

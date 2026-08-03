import { API_BASE_URL, request } from '@/lib/api';
import { getAccessToken } from '@/lib/token-store';

export type IntegrationInfo = {
  id: string;
  label: string;
  description: string;
  type: 'oauth' | 'webhook' | 'token';
  icon: string;
  configured: boolean;
  connected: boolean;
  accountName: string | null;
};

function authToken(): string {
  const token = getAccessToken();
  if (!token) {
    throw new Error('Not authenticated');
  }
  return token;
}

export async function listIntegrations(): Promise<IntegrationInfo[]> {
  const result = await request<{ integrations: IntegrationInfo[] }>('/integrations', {
    token: authToken(),
  });
  return result.integrations;
}

export function connectUrl(provider: string): string {
  return `${API_BASE_URL}/integrations/${provider}/connect`;
}

export async function saveIntegration(
  provider: string,
  data: Record<string, string>,
): Promise<void> {
  await request<void>(`/integrations/${provider}`, {
    method: 'POST',
    token: authToken(),
    body: data,
  });
}

export async function disconnectIntegration(provider: string): Promise<void> {
  await request<void>(`/integrations/${provider}`, {
    method: 'DELETE',
    token: authToken(),
  });
}

import { API_BASE_URL, request } from '@/lib/api';
import { getAccessToken } from '@/lib/token-store';

export type IntegrationType = 'oauth' | 'webhook' | 'token';

export type IntegrationConnectionStatus =
  'connected' | 'not_connected' | 'needs_refresh' | 'expired' | 'revoked' | 'error';

export type PermissionState = {
  id: string;
  label: string;
  description: string;
  scope: string;
  capability: string | null;
  enabled: boolean;
};

export type IntegrationInfo = {
  id: string;
  label: string;
  description: string;
  type: IntegrationType;
  icon: string;
  configured: boolean;
  connected: boolean;
  accountName: string | null;
  accountKey: string | null;
  status: IntegrationConnectionStatus;
  scopes: string | null;
  connectedAt: string | null;
  tokenExpiresAt: string | null;
  revokedAt: string | null;
  revokedReason: string | null;
  capabilities: string[];
  permissions: PermissionState[];
};

export type HubHealth = {
  status: IntegrationConnectionStatus;
  issue?: string | null;
  issueLabel?: string | null;
  code?: string | null;
  ok: boolean;
  latencyMs: number | null;
  lastMessage: string | null;
  lastHealthCheckAt: string;
  lastSuccessAt: string | null;
  apiStatus?: string | null;
  quota?: HealthQuota | null;
};

export type HealthQuota = {
  used: number | null;
  limit: number | null;
  remaining: number | null;
  resetAt: string | null;
};

export type HealthProvider = {
  id: string;
  label: string;
  description: string;
  type: IntegrationType;
  icon: string;
  configured: boolean;
  connected: boolean;
  accountName: string | null;
  status: IntegrationConnectionStatus;
  autoReconnect: boolean;
  tokenExpiresAt: string | null;
  lastRefreshedAt: string | null;
  refreshCount: number;
  revokedAt: string | null;
  revokedReason: string | null;
  health: HubHealth | null;
  lastSync: HubSync | null;
};

export type HealthSweep = {
  ran: boolean;
  checked: number;
  healthy: number;
  unhealthy: number;
  autoReconnected: number;
  disabled: number;
  startedAt: string | null;
  finishedAt: string | null;
};

export type HealthResponse = {
  providers: HealthProvider[];
  summary: {
    connected: number;
    healthy: number;
    unhealthy: number;
    disconnected: number;
    autoReconnectEnabled: number;
  };
  sweep: HealthSweep | null;
  monitor: {
    enabled: boolean;
    intervalMs: number;
    autoReconnectEnabled: boolean;
  };
};

export type HubSync = {
  id: string;
  kind: string;
  status: 'RUNNING' | 'SUCCESS' | 'FAILED';
  startedAt: string;
  finishedAt: string | null;
  itemCount: number | null;
  error: string | null;
};

export type HubProvider = IntegrationInfo & {
  lastRefreshedAt: string | null;
  refreshCount: number;
  health: HubHealth | null;
  lastSync: HubSync | null;
  accountCount: number;
  fields?: MarketplaceTokenField[];
};

export type PermissionCenterPermission = {
  id: string;
  label: string;
  description: string;
  scope: string;
  capability: string;
  granted: boolean;
  enabled: boolean;
};

export type PermissionCenterProvider = {
  id: string;
  label: string;
  description: string;
  icon: string;
  type: IntegrationType;
  configured: boolean;
  connected: boolean;
  accountName: string | null;
  accountKey: string | null;
  scopes: string | null;
  permissions: PermissionCenterPermission[];
};

export type ConnectionTestResult = {
  ok: boolean;
  accountName: string | null;
  message: string;
  latencyMs: number | null;
};

export type IntegrationAccount = {
  id: string;
  accountKey: string;
  accountName: string | null;
  isPrimary: boolean;
  status: IntegrationConnectionStatus;
  scopes: string | null;
  connectedAt: string;
  tokenExpiresAt: string | null;
  lastRefreshedAt: string | null;
  refreshCount: number;
  revokedAt: string | null;
  revokedReason: string | null;
};

export type SyncRecord = {
  id: string;
  integrationId: string;
  kind: string;
  status: 'RUNNING' | 'SUCCESS' | 'FAILED';
  startedAt: string;
  finishedAt: string | null;
  itemCount: number | null;
  error: string | null;
  detail: unknown;
  createdAt: string;
};

export type MarketplaceTokenField = {
  name: string;
  label: string;
  placeholder: string;
  type?: 'text' | 'password';
};

export type MarketplaceItem = {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  version: string;
  latestVersion: string;
  author: string;
  status: 'installed' | 'available' | 'future';
  authType: IntegrationType;
  providerIds: string[];
  bundled: boolean;
  requiredEnv: string[];
  installed: boolean;
  connected: boolean;
  configured: boolean;
  accountName: string | null;
  capabilities: string[];
  fields?: MarketplaceTokenField[];
  updateAvailable: boolean;
};

export type MarketplaceResponse = {
  installed: MarketplaceItem[];
  available: MarketplaceItem[];
  future: MarketplaceItem[];
};

export type RefreshResult = {
  ok: boolean;
  status: IntegrationConnectionStatus;
  tokenExpiresAt: string | null;
  lastRefreshedAt: string | null;
  refreshCount: number;
  message?: string;
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

export async function fetchHub(): Promise<HubProvider[]> {
  const result = await request<{ providers: HubProvider[] }>('/integrations/hub', {
    token: authToken(),
  });
  return result.providers;
}

export async function fetchHealth(): Promise<HealthResponse> {
  return request<HealthResponse>('/integrations/health', { token: authToken() });
}

export async function setAutoReconnect(
  provider: string,
  enabled: boolean,
): Promise<{ autoReconnect: boolean }> {
  return request<{ autoReconnect: boolean }>(`/integrations/${provider}/auto-reconnect`, {
    method: 'PUT',
    token: authToken(),
    body: { enabled },
  });
}

export async function runHealthProbe(provider: string): Promise<ConnectionTestResult> {
  return request<ConnectionTestResult>(`/integrations/${provider}/test`, {
    method: 'POST',
    token: authToken(),
  });
}

export async function listPermissions(): Promise<PermissionCenterProvider[]> {
  const result = await request<{ providers: PermissionCenterProvider[] }>(
    '/integrations/permissions',
    { token: authToken() },
  );
  return result.providers;
}

export async function updatePermissions(
  provider: string,
  permissionIds: string[],
): Promise<PermissionCenterProvider> {
  const result = await request<{ permissions: PermissionCenterProvider }>(
    `/integrations/${provider}/permissions`,
    {
      method: 'PUT',
      token: authToken(),
      body: { permissions: permissionIds },
    },
  );
  return result.permissions;
}

export function connectUrl(provider: string): string {
  return `${API_BASE_URL}/integrations/${provider}/connect`;
}

/**
 * Returns the provider's OAuth authorization URL for the current user. Uses the
 * JSON-returning reconnect endpoint (with the Bearer token) instead of the
 * redirecting connect URL, which cannot carry the Authorization header in a
 * plain browser navigation.
 */
export async function getIntegrationConnectUrl(provider: string): Promise<string> {
  const result = await request<{ url: string }>(`/integrations/${provider}/reconnect`, {
    method: 'POST',
    token: authToken(),
    body: {},
  });
  return result.url;
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

export async function testIntegration(provider: string): Promise<ConnectionTestResult> {
  return request<ConnectionTestResult>(`/integrations/${provider}/test`, {
    method: 'POST',
    token: authToken(),
  });
}

export async function reconnectIntegration(
  provider: string,
  accountKey?: string,
  scopes?: string,
): Promise<{ url: string; accountKey: string | null }> {
  return request<{ url: string; accountKey: string | null }>(
    `/integrations/${provider}/reconnect`,
    {
      method: 'POST',
      token: authToken(),
      body: {
        ...(accountKey ? { accountKey } : {}),
        ...(scopes ? { scopes } : {}),
      },
    },
  );
}

export async function refreshIntegration(provider: string): Promise<RefreshResult> {
  return request<RefreshResult>(`/integrations/${provider}/refresh`, {
    method: 'POST',
    token: authToken(),
  });
}

export async function listAccounts(provider: string): Promise<IntegrationAccount[]> {
  const result = await request<{ accounts: IntegrationAccount[] }>(
    `/integrations/${provider}/accounts`,
    { token: authToken() },
  );
  return result.accounts;
}

export async function setPrimaryAccount(provider: string, accountId: string): Promise<void> {
  await request<void>(`/integrations/${provider}/accounts/${accountId}/primary`, {
    method: 'POST',
    token: authToken(),
  });
}

export async function deleteAccount(provider: string, accountId: string): Promise<void> {
  await request<void>(`/integrations/${provider}/accounts/${accountId}`, {
    method: 'DELETE',
    token: authToken(),
  });
}

export async function syncHistory(provider: string, limit = 8): Promise<SyncRecord[]> {
  const result = await request<{ history: SyncRecord[] }>(
    `/integrations/${provider}/sync-history?limit=${limit}`,
    { token: authToken() },
  );
  return result.history;
}

export async function fetchMarketplace(): Promise<MarketplaceResponse> {
  return request<MarketplaceResponse>('/integrations/marketplace', { token: authToken() });
}

export async function installMarketplaceItem(itemId: string): Promise<MarketplaceItem> {
  const result = await request<{ item: MarketplaceItem }>(
    `/integrations/marketplace/${itemId}/install`,
    { method: 'POST', token: authToken() },
  );
  return result.item;
}

export async function uninstallMarketplaceItem(itemId: string): Promise<MarketplaceItem> {
  const result = await request<{ item: MarketplaceItem }>(`/integrations/marketplace/${itemId}`, {
    method: 'DELETE',
    token: authToken(),
  });
  return result.item;
}

export async function updateMarketplaceItem(
  itemId: string,
): Promise<{ updated: boolean; message: string }> {
  return request<{ updated: boolean; message: string }>(
    `/integrations/marketplace/${itemId}/update`,
    { method: 'POST', token: authToken() },
  );
}

// ── Admin credential management ───────────────────────────────────────────

export type AdminCredentialStatus = {
  hasClientId: boolean;
  hasClientSecret: boolean;
  hasApiKey: boolean;
  hasWebhookUrl: boolean;
  hasAccessToken: boolean;
  updatedAt: string;
};

export async function listAdminCredentials(): Promise<Record<string, AdminCredentialStatus>> {
  const result = await request<{ credentials: Record<string, AdminCredentialStatus> }>(
    '/integrations/admin/credentials',
    { token: authToken() },
  );
  return result.credentials;
}

export async function getAdminCredentialStatus(
  provider: string,
): Promise<AdminCredentialStatus | null> {
  const result = await request<{ credential: AdminCredentialStatus | null }>(
    `/integrations/admin/credentials/${provider}`,
    { token: authToken() },
  );
  return result.credential;
}

export async function saveAdminCredential(
  provider: string,
  data: Record<string, string>,
): Promise<void> {
  await request<void>(`/integrations/admin/credentials/${provider}`, {
    method: 'PUT',
    token: authToken(),
    body: data,
  });
}

export async function deleteAdminCredential(provider: string): Promise<void> {
  await request<void>(`/integrations/admin/credentials/${provider}`, {
    method: 'DELETE',
    token: authToken(),
  });
}

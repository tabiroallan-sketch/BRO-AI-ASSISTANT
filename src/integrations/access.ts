import { ProviderError, notConnectedError, permissionDeniedError } from './errors.js';
import { getProvider } from './providers.js';
import { getIntegration, getValidAccessToken } from './store.js';
import { getPermissionSet } from './trust-store.js';

export async function requireProviderToken(userId: string, providerId: string): Promise<string> {
  const token = await getValidAccessToken(userId, providerId);
  if (!token) {
    const provider = getProvider(providerId);
    const label = provider?.label ?? providerId;
    throw new ProviderError(notConnectedError(label), {
      code: 'TOKEN_MISSING',
      providerId,
    });
  }
  return token;
}

/**
 * Guards a tool call behind a Permission Center toggle. Requires the provider
 * to be connected, then blocks the call when the user has explicitly disabled
 * the permission for it. Fails open when no permission set was recorded yet
 * (e.g. webhook/token providers or integrations connected before the Permission
 * Center existed), so existing behavior is preserved until the user toggles a
 * permission off.
 */
export async function requirePermission(
  userId: string,
  providerId: string,
  permissionId: string,
): Promise<string> {
  const token = await requireProviderToken(userId, providerId);
  const integration = await getIntegration(userId, providerId);
  if (!integration) {
    return token;
  }
  const permissionSet = await getPermissionSet(integration.id);
  if (permissionSet == null || permissionSet.permissionIds.includes(permissionId)) {
    return token;
  }
  const provider = getProvider(providerId);
  const permission = provider?.permissions.find((item) => item.id === permissionId);
  throw new ProviderError(
    permissionDeniedError(provider?.label ?? providerId, permission?.label ?? permissionId),
    { code: 'PERMISSION_DENIED', providerId },
  );
}

export async function getIntegrationRecord(
  userId: string,
  providerId: string,
): Promise<{ token: string; metadata: Record<string, unknown> }> {
  const integration = await getIntegration(userId, providerId);
  if (!integration) {
    const provider = getProvider(providerId);
    const label = provider?.label ?? providerId;
    throw new ProviderError(notConnectedError(label), {
      code: 'TOKEN_MISSING',
      providerId,
    });
  }
  const metadata =
    typeof integration.metadata === 'object' && integration.metadata !== null
      ? (integration.metadata as Record<string, unknown>)
      : {};
  return { token: integration.accessToken, metadata };
}

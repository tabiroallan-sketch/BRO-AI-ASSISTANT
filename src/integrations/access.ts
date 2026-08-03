import { getProvider } from './providers.js';
import { getIntegration, getValidAccessToken } from './store.js';

export async function requireProviderToken(userId: string, providerId: string): Promise<string> {
  const token = await getValidAccessToken(userId, providerId);
  if (!token) {
    const provider = getProvider(providerId);
    const label = provider?.label ?? providerId;
    throw new Error(
      `The user has not connected ${label}. Ask them to connect it from Settings → Integrations, then try again.`,
    );
  }
  return token;
}

export async function getIntegrationRecord(
  userId: string,
  providerId: string,
): Promise<{ token: string; metadata: Record<string, unknown> }> {
  const integration = await getIntegration(userId, providerId);
  if (!integration) {
    const provider = getProvider(providerId);
    const label = provider?.label ?? providerId;
    throw new Error(
      `The user has not connected ${label}. Ask them to connect it from Settings → Integrations, then try again.`,
    );
  }
  const metadata =
    typeof integration.metadata === 'object' && integration.metadata !== null
      ? (integration.metadata as Record<string, unknown>)
      : {};
  return { token: integration.accessToken, metadata };
}

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

process.env.NEXT_PUBLIC_API_URL = 'http://e2e.local/api/v1';

const { requestMock, getAccessTokenMock } = vi.hoisted(() => ({
  requestMock: vi.fn<() => Promise<unknown>>(),
  getAccessTokenMock: vi.fn<() => string | null>(),
}));

vi.mock('@/lib/api', () => ({
  API_BASE_URL: 'http://e2e.local/api/v1',
  request: requestMock,
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
}));

vi.mock('@/lib/token-store', () => ({
  getAccessToken: getAccessTokenMock,
}));

describe('web integration lib', () => {
  let connectUrl: (provider: string) => string;
  let getIntegrationConnectUrl: (provider: string) => Promise<string>;
  let disconnectIntegration: (provider: string) => Promise<void>;

  beforeEach(() => {
    requestMock.mockReset();
    getAccessTokenMock.mockReset();
  });

  beforeAll(async () => {
    const integrationModule = await import('@/lib/integrations');
    connectUrl = integrationModule.connectUrl;
    getIntegrationConnectUrl = integrationModule.getIntegrationConnectUrl;
    disconnectIntegration = integrationModule.disconnectIntegration;
  });

  it('builds the redirect connect URL from the API base', () => {
    expect(connectUrl('github')).toBe('http://e2e.local/api/v1/integrations/github/connect');
    expect(connectUrl('google')).toBe('http://e2e.local/api/v1/integrations/google/connect');
  });

  it('fetches the OAuth authorization URL via the JSON reconnect endpoint', async () => {
    getAccessTokenMock.mockReturnValue('jwt-token');
    requestMock.mockResolvedValue({ url: 'https://accounts.google.com/o/oauth2/v2/auth?state=x' });

    const url = await getIntegrationConnectUrl('google');

    expect(url).toBe('https://accounts.google.com/o/oauth2/v2/auth?state=x');
    expect(requestMock).toHaveBeenCalledWith('/integrations/google/reconnect', {
      method: 'POST',
      token: 'jwt-token',
      body: {},
    });
  });

  it('throws when no access token is available', async () => {
    getAccessTokenMock.mockReturnValue(null);
    await expect(getIntegrationConnectUrl('github')).rejects.toThrow('Not authenticated');
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('sends a DELETE with the bearer token when disconnecting', async () => {
    getAccessTokenMock.mockReturnValue('jwt-token');
    requestMock.mockResolvedValue(undefined);
    await disconnectIntegration('slack');
    expect(requestMock).toHaveBeenCalledWith('/integrations/slack', {
      method: 'DELETE',
      token: 'jwt-token',
    });
  });
});

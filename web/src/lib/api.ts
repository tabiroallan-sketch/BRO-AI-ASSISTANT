import { clearTokens, getAccessToken, getRefreshToken, setTokens } from './token-store';

function resolveApiBaseUrl(): string {
  if (typeof window !== 'undefined') {
    const injected = (window as { __BRO_API_URL__?: string }).__BRO_API_URL__;
    if (injected) {
      return injected;
    }
  }
  return process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000/api/v1';
}

export const API_BASE_URL = resolveApiBaseUrl();

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export type PublicUser = {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  role: 'USER' | 'ADMIN';
};

export type AuthResponse = {
  accessToken: string;
  refreshToken: string;
  user: PublicUser;
};

export type ProviderInfo = {
  id: string;
  label: string;
};

type RequestOptions = {
  method?: string;
  body?: unknown;
  token?: string;
  skipAuthRetry?: boolean;
};

type ErrorEnvelope = {
  error?: {
    message?: string;
  };
};

const NO_RETRY_PATHS = new Set(['/auth/login', '/auth/register', '/auth/refresh', '/auth/logout']);

let refreshPromise: Promise<AuthResponse> | null = null;

function performRefresh(): Promise<AuthResponse> {
  if (!refreshPromise) {
    const refreshToken = getRefreshToken();
    if (!refreshToken) {
      refreshPromise = Promise.reject(new ApiError(401, 'No refresh token available'));
    } else {
      refreshPromise = request<AuthResponse>('/auth/refresh', {
        method: 'POST',
        body: { refreshToken },
        skipAuthRetry: true,
      });
    }
    refreshPromise.then(
      () => {
        refreshPromise = null;
      },
      () => {
        refreshPromise = null;
      },
    );
  }
  return refreshPromise;
}

async function readResponse(response: Response): Promise<unknown> {
  if (response.status === 204) {
    return undefined;
  }
  return response.json().catch(() => null);
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const token = options.token ?? getAccessToken();
  const headers: Record<string, string> = {};
  if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
  }
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }

  const doFetch = (): Promise<Response> =>
    fetch(`${API_BASE_URL}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  let response = await doFetch();

  if (response.status === 401 && !options.skipAuthRetry && !NO_RETRY_PATHS.has(path)) {
    try {
      const refreshed = await performRefresh();
      setTokens(refreshed.accessToken, refreshed.refreshToken);
      headers.authorization = `Bearer ${refreshed.accessToken}`;
      response = await doFetch();
    } catch {
      clearTokens();
      throw new ApiError(response.status, 'Session expired');
    }
  }

  const data = (await readResponse(response)) as ErrorEnvelope | T | null;

  if (!response.ok) {
    const message =
      (data as ErrorEnvelope | null)?.error?.message ?? `Request failed (${response.status})`;
    throw new ApiError(response.status, message);
  }

  return data as T;
}

export function login(email: string, password: string): Promise<AuthResponse> {
  return request<AuthResponse>('/auth/login', {
    method: 'POST',
    body: { email, password },
  });
}

export function register(
  email: string,
  password: string,
  displayName?: string,
): Promise<AuthResponse> {
  return request<AuthResponse>('/auth/register', {
    method: 'POST',
    body: { email, password, ...(displayName ? { displayName } : {}) },
  });
}

export function refresh(): Promise<AuthResponse> {
  return performRefresh();
}

export async function logout(): Promise<void> {
  const refreshToken = getRefreshToken();
  if (refreshToken) {
    try {
      await request<void>('/auth/logout', {
        method: 'POST',
        body: { refreshToken },
      });
    } finally {
      clearTokens();
    }
  }
}

export function fetchMe(token: string): Promise<{ user: PublicUser }> {
  return request<{ user: PublicUser }>('/auth/me', { token });
}

export type UpdateProfileInput = {
  displayName?: string | null;
  avatarUrl?: string | null;
};

export function updateProfile(input: UpdateProfileInput): Promise<{ user: PublicUser }> {
  return request<{ user: PublicUser }>('/auth/me', {
    method: 'PATCH',
    body: input,
  });
}

export function fetchProviders(): Promise<{ providers: ProviderInfo[] }> {
  return request<{ providers: ProviderInfo[] }>('/auth/providers');
}

export const GOOGLE_AUTH_URL = `${API_BASE_URL}/auth/google`;

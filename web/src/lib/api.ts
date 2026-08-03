import { getRefreshToken } from './token-store';

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000/api/v1';

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
};

type ErrorEnvelope = {
  error?: {
    message?: string;
  };
};

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (options.token) {
    headers.authorization = `Bearer ${options.token}`;
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const data = (await response.json().catch(() => null)) as ErrorEnvelope | T | null;

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
  const refreshToken = getRefreshToken();
  if (!refreshToken) {
    return Promise.reject(new ApiError(401, 'No refresh token available'));
  }
  return request<AuthResponse>('/auth/refresh', {
    method: 'POST',
    body: { refreshToken },
  });
}

export async function logout(): Promise<void> {
  const refreshToken = getRefreshToken();
  if (refreshToken) {
    await request<void>('/auth/logout', {
      method: 'POST',
      body: { refreshToken },
    });
  }
}

export function fetchMe(token: string): Promise<{ user: PublicUser }> {
  return request<{ user: PublicUser }>('/auth/me', { token });
}

export function fetchProviders(): Promise<{ providers: ProviderInfo[] }> {
  return request<{ providers: ProviderInfo[] }>('/auth/providers');
}

export const GOOGLE_AUTH_URL = `${API_BASE_URL}/auth/google`;

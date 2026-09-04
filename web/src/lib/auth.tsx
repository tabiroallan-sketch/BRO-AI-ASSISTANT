'use client';

import * as React from 'react';
import * as api from '@/lib/api';
import { clearTokens, getAccessToken, setTokens } from '@/lib/token-store';

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

type AuthContextValue = {
  user: api.PublicUser | null;
  status: AuthStatus;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName?: string) => Promise<void>;
  updateProfile: (input: api.UpdateProfileInput) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = React.createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [user, setUser] = React.useState<api.PublicUser | null>(null);
  const [status, setStatus] = React.useState<AuthStatus>('loading');

  React.useEffect(() => {
    let cancelled = false;

    async function bootstrap(): Promise<void> {
      const accessToken = getAccessToken();
      if (!accessToken) {
        setStatus('unauthenticated');
        return;
      }

      try {
        const { user: current } = await api.fetchMe(accessToken);
        if (!cancelled) {
          setUser(current);
          setStatus('authenticated');
        }
      } catch (error) {
        if (!cancelled) {
          if (error instanceof api.ApiError && error.status === 401) {
            clearTokens();
            setUser(null);
          }
          setStatus('unauthenticated');
        }
      }
    }

    void bootstrap();

    return () => {
      cancelled = true;
    };
  }, []);

  const login = React.useCallback(async (email: string, password: string) => {
    const result = await api.login(email, password);
    setTokens(result.accessToken, result.refreshToken);
    setUser(result.user);
    setStatus('authenticated');
  }, []);

  const register = React.useCallback(
    async (email: string, password: string, displayName?: string) => {
      const result = await api.register(email, password, displayName);
      setTokens(result.accessToken, result.refreshToken);
      setUser(result.user);
      setStatus('authenticated');
    },
    [],
  );

  const logout = React.useCallback(async () => {
    try {
      await api.logout();
    } finally {
      clearTokens();
      setUser(null);
      setStatus('unauthenticated');
    }
  }, []);

  const updateProfile = React.useCallback(async (input: api.UpdateProfileInput) => {
    const { user: updated } = await api.updateProfile(input);
    setUser(updated);
  }, []);

  const value = React.useMemo<AuthContextValue>(
    () => ({ user, status, login, register, updateProfile, logout }),
    [user, status, login, register, updateProfile, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = React.useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

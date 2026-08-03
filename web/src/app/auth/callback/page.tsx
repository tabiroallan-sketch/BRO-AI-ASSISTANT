'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { setTokens } from '@/lib/token-store';

export default function AuthCallbackPage(): React.JSX.Element {
  const router = useRouter();
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const hash = window.location.hash.slice(1);
    const params = new URLSearchParams(hash);

    const accessToken = params.get('access_token');
    const refreshToken = params.get('refresh_token');
    const errorParam = params.get('error');

    if (errorParam) {
      setError(errorParam);
      return;
    }

    if (!accessToken || !refreshToken) {
      setError('Invalid OAuth response: missing tokens.');
      return;
    }

    setTokens(accessToken, refreshToken);
    router.replace('/dashboard');
  }, [router]);

  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : (
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      )}
    </div>
  );
}

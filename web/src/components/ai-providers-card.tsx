'use client';

import * as React from 'react';
import { Cpu, Gem, KeyRound, Loader2, Sparkles, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  clearLLMApiKey,
  getLLMSettings,
  listLLMModels,
  listLLMProviders,
  saveLLMSettings,
  testLLMProvider,
  type LLMModelInfo,
  type LLMProviderInfo,
  type LLMSettings,
} from '@/lib/llm';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const PROVIDER_ICONS: Record<string, typeof Cpu> = {
  nvidia: Cpu,
  gemini: Gem,
};

function formatTestedAt(value: string | null): string {
  if (!value) {
    return 'Never';
  }
  try {
    return new Date(value).toLocaleString();
  } catch {
    return 'Unknown';
  }
}

function StatusBadge({ settings }: { settings: LLMSettings }): React.JSX.Element {
  if (settings.status === 'connected') {
    return (
      <Badge className="border-transparent bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
        Connected
      </Badge>
    );
  }
  if (settings.status && settings.status !== 'connected') {
    return <Badge variant="destructive">Connection error</Badge>;
  }
  if (settings.activeProvider?.configured) {
    return <Badge variant="secondary">Configured</Badge>;
  }
  return <Badge variant="outline">Not configured</Badge>;
}

export const AiProvidersCard = React.memo(function AiProvidersCard(): React.JSX.Element | null {
  const router = useRouter();
  const { logout, user } = useAuth();
  const [providers, setProviders] = React.useState<LLMProviderInfo[] | null>(null);
  const [settings, setSettings] = React.useState<LLMSettings | null>(null);
  const [models, setModels] = React.useState<Record<string, LLMModelInfo[]>>({});
  const [selectedProvider, setSelectedProvider] = React.useState('');
  const [selectedModel, setSelectedModel] = React.useState('');
  const [apiKey, setApiKey] = React.useState('');
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  const isAdmin = user?.role === 'ADMIN';

  async function refreshSettings(): Promise<void> {
    setSettings(await getLLMSettings());
  }

  async function loadModels(providerId: string): Promise<void> {
    if (models[providerId]) {
      return;
    }
    try {
      const result = await listLLMModels(providerId);
      setModels((current) => ({ ...current, [providerId]: result.models }));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        await logout();
        router.replace('/login');
        return;
      }
      setError(err instanceof ApiError ? err.message : 'Failed to load models.');
    }
  }

  React.useEffect(() => {
    if (!isAdmin) {
      return;
    }
    let cancelled = false;
    async function bootstrap(): Promise<void> {
      try {
        const [providerResult, settingsResult] = await Promise.all([
          listLLMProviders(),
          getLLMSettings(),
        ]);
        if (cancelled) {
          return;
        }
        setProviders(providerResult.providers);
        setSettings(settingsResult);
        const fallbackId =
          settingsResult.activeProvider?.id ?? providerResult.providers[0]?.id ?? '';
        setSelectedProvider(fallbackId);
        setSelectedModel(
          settingsResult.activeProvider?.id === settingsResult.providerId && settingsResult.model
            ? settingsResult.model
            : (providerResult.providers.find((provider) => provider.id === fallbackId)
                ?.defaultModel ?? ''),
        );
        if (fallbackId) {
          await loadModels(fallbackId);
        }
      } catch (err) {
        if (cancelled) {
          return;
        }
        if (err instanceof ApiError && err.status === 401) {
          await logout();
          router.replace('/login');
          return;
        }
        setError(err instanceof ApiError ? err.message : 'Failed to load AI provider settings.');
      }
    }
    void bootstrap();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  async function handleProviderChange(providerId: string): Promise<void> {
    setSelectedProvider(providerId);
    setError(null);
    const provider = providers?.find((entry) => entry.id === providerId);
    setSelectedModel(provider?.defaultModel ?? '');
    await loadModels(providerId);
  }

  async function handleSave(): Promise<void> {
    setBusy('save');
    setNotice(null);
    setError(null);
    try {
      await saveLLMSettings({
        providerId: selectedProvider,
        ...(selectedModel.trim() ? { model: selectedModel.trim() } : {}),
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      });
      await refreshSettings();
      setApiKey('');
      setNotice('AI provider settings saved.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save AI provider settings.');
    } finally {
      setBusy(null);
    }
  }

  async function handleTest(): Promise<void> {
    setBusy('test');
    setNotice(null);
    setError(null);
    try {
      const result = await testLLMProvider(selectedProvider, {
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        ...(selectedModel.trim() ? { model: selectedModel.trim() } : {}),
      });
      await refreshSettings();
      setNotice(
        result.ok
          ? `Connected in ${result.latencyMs ?? '?'}ms.`
          : `Connection failed: ${result.message}`,
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Connection test failed.');
    } finally {
      setBusy(null);
    }
  }

  async function handleClearApiKey(): Promise<void> {
    setBusy('clear');
    setNotice(null);
    setError(null);
    try {
      await clearLLMApiKey();
      await refreshSettings();
      setApiKey('');
      setNotice('Saved API key cleared.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to clear the API key.');
    } finally {
      setBusy(null);
    }
  }

  if (!isAdmin) {
    return null;
  }

  if (providers === null || settings === null) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>AI Provider</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading AI provider settings…
        </CardContent>
      </Card>
    );
  }

  const activeProvider = settings.activeProvider;
  const provider = providers.find((entry) => entry.id === selectedProvider) ?? activeProvider;
  const Icon = PROVIDER_ICONS[selectedProvider] ?? Sparkles;
  const hasConnectionError = settings.status !== null && settings.status !== 'connected';
  const lastConnectionLabel =
    settings.status === 'connected'
      ? `${formatTestedAt(settings.lastTestedAt)}${settings.latencyMs !== null ? ` (${settings.latencyMs}ms)` : ''}`
      : formatTestedAt(settings.lastTestedAt);

  return (
    <Card>
      <CardHeader>
        <CardTitle>AI Provider</CardTitle>
        <CardDescription>
          Choose the language model provider BRO uses for chat and agents. Settings are saved
          server-side and used by everyone.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-3 rounded-lg border bg-accent/40 p-4 sm:grid-cols-2">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Current provider
            </p>
            <p className="mt-1 text-sm font-medium">
              {activeProvider ? `${activeProvider.label} (${activeProvider.id})` : 'None selected'}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {activeProvider?.description ?? 'No provider configured yet.'}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Current model</p>
            <p className="mt-1 text-sm font-medium">
              {settings.model ?? activeProvider?.defaultModel ?? 'Not set'}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {settings.model ? 'Active model for chat' : 'Provider default will be used.'}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Provider status</p>
            <div className="mt-1.5">
              <StatusBadge settings={settings} />
            </div>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Last connection</p>
            <p
              className={
                hasConnectionError
                  ? 'mt-1 text-sm font-medium text-destructive'
                  : 'mt-1 text-sm font-medium'
              }
            >
              {settings.status === 'connected'
                ? 'Successful'
                : settings.status
                  ? 'Failed'
                  : 'Not tested'}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{lastConnectionLabel}</p>
          </div>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
        {notice && <p className="text-sm text-emerald-600 dark:text-emerald-400">{notice}</p>}

        {hasConnectionError && settings.message && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {settings.message}
          </p>
        )}

        <div className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ai-provider">Provider</Label>
              <div className="flex items-center gap-2">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent">
                  <Icon className="h-4 w-4" />
                </div>
                <select
                  id="ai-provider"
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                  value={selectedProvider}
                  onChange={(event) => void handleProviderChange(event.target.value)}
                >
                  {providers.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ai-model">Model</Label>
              <select
                id="ai-model"
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                value={selectedModel}
                onFocus={() => void loadModels(selectedProvider)}
                onChange={(event) => setSelectedModel(event.target.value)}
              >
                <option value="">{provider?.defaultModel ?? 'Select a model'}</option>
                {(models[selectedProvider] ?? []).map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name ?? model.id}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ai-api-key">API key</Label>
            <Input
              id="ai-api-key"
              type="password"
              autoComplete="off"
              placeholder={
                settings.hasApiKey
                  ? 'Saved — enter a new key to replace it'
                  : `Paste ${provider?.envVar ?? 'your API key'}`
              }
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {settings.hasApiKey
                ? 'An API key is saved and used automatically.'
                : 'No API key saved yet.'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => void handleSave()} disabled={busy !== null || !selectedProvider}>
              {busy === 'save' ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Save settings
            </Button>
            <Button
              variant="outline"
              onClick={() => void handleTest()}
              disabled={busy !== null || !selectedProvider}
            >
              {busy === 'test' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <KeyRound className="h-4 w-4" />
              )}
              Test connection
            </Button>
            {settings.hasApiKey && (
              <Button
                variant="outline"
                onClick={() => void handleClearApiKey()}
                disabled={busy !== null}
                className="text-destructive hover:text-destructive"
              >
                {busy === 'clear' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
                Clear API key
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
});

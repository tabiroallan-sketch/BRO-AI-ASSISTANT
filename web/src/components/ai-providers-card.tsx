'use client';

import * as React from 'react';
import { Cpu, KeyRound, Loader2, Sparkles } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  listLLMModels,
  listLLMProviders,
  setLLMModel,
  testLLMProvider,
  type LLMModelInfo,
  type LLMProviderInfo,
} from '@/lib/llm';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';

type ProviderResult = {
  ok: boolean;
  status: string;
  message: string;
  latencyMs?: number;
};

const PROVIDER_ICONS: Record<string, typeof Cpu> = {
  nvidia: Cpu,
};

function statusLabel(result: ProviderResult): string {
  if (result.ok) {
    return result.latencyMs !== undefined ? `Connected (${result.latencyMs}ms)` : 'Connected';
  }
  return result.message;
}

export const AiProvidersCard = React.memo(function AiProvidersCard(): React.JSX.Element {
  const router = useRouter();
  const { logout } = useAuth();
  const [providers, setProviders] = React.useState<LLMProviderInfo[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [models, setModels] = React.useState<Record<string, LLMModelInfo[]>>({});
  const [selectedModel, setSelectedModel] = React.useState<Record<string, string>>({});
  const [apiKeys, setApiKeys] = React.useState<Record<string, string>>({});
  const [testing, setTesting] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState<string | null>(null);
  const [results, setResults] = React.useState<Record<string, ProviderResult>>({});

  async function load(): Promise<void> {
    try {
      const result = await listLLMProviders();
      setProviders(result.providers);
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        await logout();
        router.replace('/login');
        return;
      }
      setError('Failed to load AI providers.');
    }
  }

  async function loadModels(providerId: string): Promise<void> {
    if (models[providerId]) {
      return;
    }
    try {
      const result = await listLLMModels(providerId);
      setModels((current) => ({ ...current, [providerId]: result.models }));
      if (result.defaultModel) {
        setSelectedModel((current) => ({
          ...current,
          [providerId]: current[providerId] ?? result.defaultModel ?? '',
        }));
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load models.');
    }
  }

  React.useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleTest(providerId: string): Promise<void> {
    setTesting(providerId);
    setNotice(null);
    setError(null);
    try {
      const result = await testLLMProvider(providerId, {
        ...(apiKeys[providerId]?.trim() ? { apiKey: apiKeys[providerId].trim() } : {}),
        ...(selectedModel[providerId]?.trim() ? { model: selectedModel[providerId].trim() } : {}),
      });
      setResults((current) => ({ ...current, [providerId]: result }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Connection test failed.');
    } finally {
      setTesting(null);
    }
  }

  async function handleSetModel(providerId: string): Promise<void> {
    const model = selectedModel[providerId]?.trim();
    if (!model) {
      return;
    }
    setSaving(providerId);
    setNotice(null);
    setError(null);
    try {
      await setLLMModel(providerId, model);
      setNotice(`${providerId} active model set to ${model}.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to set active model.');
    } finally {
      setSaving(null);
    }
  }

  if (providers === null) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>AI Providers</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading AI providers…
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>AI Providers</CardTitle>
        <CardDescription>
          Configure which language model providers BRO can use for chat and agents.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <p className="text-sm text-destructive">{error}</p>}
        {notice && <p className="text-sm text-emerald-600 dark:text-emerald-400">{notice}</p>}
        {providers.map((provider) => {
          const Icon = PROVIDER_ICONS[provider.id] ?? Sparkles;
          const providerModels = models[provider.id];
          const result = results[provider.id];
          return (
            <div key={provider.id} className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-md bg-accent">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">{provider.label}</p>
                    <p className="text-xs text-muted-foreground">{provider.description}</p>
                    {provider.defaultModel && (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Default model: {provider.defaultModel}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {provider.configured ? (
                    <Badge variant="secondary">Configured</Badge>
                  ) : (
                    <Badge variant="outline">Not configured</Badge>
                  )}
                </div>
              </div>
              <div className="flex flex-col gap-3">
                <div className="flex flex-1 flex-wrap items-end justify-end gap-2">
                  <div className="flex min-w-56 flex-col gap-1">
                    <Label htmlFor={`${provider.id}-model`}>Model</Label>
                    <select
                      id={`${provider.id}-model`}
                      className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                      value={selectedModel[provider.id] ?? ''}
                      onFocus={() => void loadModels(provider.id)}
                      onChange={(event) =>
                        setSelectedModel((current) => ({
                          ...current,
                          [provider.id]: event.target.value,
                        }))
                      }
                    >
                      <option value="">
                        {providerModels
                          ? 'Select a model'
                          : (provider.defaultModel ?? 'Select a model')}
                      </option>
                      {(providerModels ?? []).map((model) => (
                        <option key={model.id} value={model.id}>
                          {model.name ?? model.id}
                        </option>
                      ))}
                    </select>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={saving === provider.id || !selectedModel[provider.id]?.trim()}
                    onClick={() => void handleSetModel(provider.id)}
                  >
                    {saving === provider.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      'Set active model'
                    )}
                  </Button>
                </div>
                {provider.requiresApiKey && (
                  <div className="flex flex-1 flex-wrap items-end justify-end gap-2">
                    <div className="flex min-w-56 flex-col gap-1">
                      <Label htmlFor={`${provider.id}-apikey`}>
                        API key (overrides {provider.envVar})
                      </Label>
                      <Input
                        id={`${provider.id}-apikey`}
                        type="password"
                        placeholder={provider.envVar}
                        value={apiKeys[provider.id] ?? ''}
                        onChange={(event) =>
                          setApiKeys((current) => ({
                            ...current,
                            [provider.id]: event.target.value,
                          }))
                        }
                      />
                    </div>
                    <Button
                      size="sm"
                      disabled={testing === provider.id}
                      onClick={() => void handleTest(provider.id)}
                    >
                      {testing === provider.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <>
                          <KeyRound className="h-4 w-4" /> Test connection
                        </>
                      )}
                    </Button>
                  </div>
                )}
                {result && (
                  <p
                    className={
                      result.ok
                        ? 'text-sm text-emerald-600 dark:text-emerald-400'
                        : 'text-sm text-destructive'
                    }
                  >
                    {statusLabel(result)}
                  </p>
                )}
              </div>
              <Separator />
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
});

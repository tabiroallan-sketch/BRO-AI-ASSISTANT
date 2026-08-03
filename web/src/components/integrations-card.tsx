'use client';

import * as React from 'react';
import {
  Calendar,
  ExternalLink,
  FileText,
  Folder,
  Github,
  Loader2,
  Mail,
  MessageCircle,
  MessagesSquare,
  Slack,
  type LucideIcon,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  connectUrl,
  disconnectIntegration,
  listIntegrations,
  saveIntegration,
  type IntegrationInfo,
} from '@/lib/integrations';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';

const PROVIDER_ICONS: Record<string, LucideIcon> = {
  'google-calendar': Calendar,
  'google-gmail': Mail,
  'google-drive': Folder,
  github: Github,
  slack: Slack,
  discord: MessagesSquare,
  notion: FileText,
  whatsapp: MessageCircle,
};

type Field = { name: string; label: string; placeholder: string };

const CONFIG_FIELDS: Record<string, Field[]> = {
  discord: [
    {
      name: 'webhookUrl',
      label: 'Webhook URL',
      placeholder: 'https://discord.com/api/webhooks/...',
    },
  ],
  whatsapp: [
    {
      name: 'token',
      label: 'Access token',
      placeholder: 'Permanent WhatsApp Business API token',
    },
    { name: 'phoneNumberId', label: 'Phone number ID', placeholder: 'e.g. 123456789012345' },
  ],
};

export function IntegrationsCard(): React.JSX.Element {
  const router = useRouter();
  const { logout } = useAuth();
  const [integrations, setIntegrations] = React.useState<IntegrationInfo[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [drafts, setDrafts] = React.useState<Record<string, Record<string, string>>>({});

  async function load(): Promise<void> {
    try {
      const result = await listIntegrations();
      setIntegrations(result);
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        await logout();
        router.replace('/login');
        return;
      }
      setError('Failed to load integrations.');
    }
  }

  React.useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const provider = params.get('integration');
    const status = params.get('status');
    if (provider && status === 'connected') {
      setNotice(`${provider} connected successfully.`);
      window.history.replaceState({}, '', window.location.pathname);
      void load();
    } else if (provider && status === 'error') {
      const reason = params.get('reason');
      setError(reason ? `Connection failed: ${reason}` : 'Connection failed.');
      window.history.replaceState({}, '', window.location.pathname);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleDisconnect(provider: string): Promise<void> {
    await disconnectIntegration(provider).catch(() => undefined);
    await load();
  }

  async function handleSave(provider: string): Promise<void> {
    const values = drafts[provider] ?? {};
    try {
      await saveIntegration(provider, values);
      setNotice('Saved.');
      setDrafts((current) => ({ ...current, [provider]: {} }));
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save.');
    }
  }

  if (integrations === null) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Integrations</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading integrations…
        </CardContent>
      </Card>
    );
  }

  function ConfigForm({
    provider,
    fields,
  }: {
    provider: string;
    fields: Field[];
  }): React.JSX.Element {
    return (
      <form
        className="flex flex-1 flex-wrap items-end justify-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void handleSave(provider);
        }}
      >
        {fields.map((field) => (
          <div key={field.name} className="flex min-w-64 flex-col gap-1">
            <Label htmlFor={`${provider}-${field.name}`}>{field.label}</Label>
            <Input
              id={`${provider}-${field.name}`}
              type={field.name === 'token' ? 'password' : 'text'}
              placeholder={field.placeholder}
              value={drafts[provider]?.[field.name] ?? ''}
              onChange={(event) =>
                setDrafts((current) => ({
                  ...current,
                  [provider]: {
                    ...(current[provider] ?? {}),
                    [field.name]: event.target.value,
                  },
                }))
              }
            />
          </div>
        ))}
        <Button type="submit" size="sm">
          Save
        </Button>
      </form>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Integrations</CardTitle>
        <CardDescription>
          Connect third-party services so BRO can read and send data on your behalf.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <p className="text-sm text-destructive">{error}</p>}
        {notice && <p className="text-sm text-emerald-600 dark:text-emerald-400">{notice}</p>}
        {integrations.map((integration) => {
          const Icon = PROVIDER_ICONS[integration.id] ?? ExternalLink;
          const fields = CONFIG_FIELDS[integration.id] ?? [];
          return (
            <div key={integration.id} className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-md bg-accent">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">{integration.label}</p>
                    <p className="text-xs text-muted-foreground">{integration.description}</p>
                    {integration.connected && integration.accountName && (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Connected as {integration.accountName}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {integration.connected ? (
                    <Badge variant="secondary">Connected</Badge>
                  ) : (
                    <Badge variant="outline">
                      {integration.configured ? 'Not connected' : 'Not configured'}
                    </Badge>
                  )}
                </div>
              </div>
              <div className="flex items-center justify-end gap-2">
                {!integration.connected &&
                  integration.configured &&
                  integration.type === 'oauth' && (
                    <Button asChild size="sm">
                      <a href={connectUrl(integration.id)}>Connect</a>
                    </Button>
                  )}
                {(integration.type === 'webhook' || integration.type === 'token') &&
                  !integration.connected && (
                    <ConfigForm provider={integration.id} fields={fields} />
                  )}
                {integration.connected && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void handleDisconnect(integration.id)}
                  >
                    Disconnect
                  </Button>
                )}
              </div>
              <Separator />
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

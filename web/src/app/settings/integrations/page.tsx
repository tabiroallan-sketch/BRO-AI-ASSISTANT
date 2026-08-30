'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { RequireAuth } from '@/components/require-auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Check, Loader2, Save, Trash2 } from 'lucide-react';
import {
  type AdminCredentialStatus,
  listAdminCredentials,
  saveAdminCredential,
  deleteAdminCredential,
} from '@/lib/integrations';

type ProviderField = {
  name: string;
  label: string;
  placeholder: string;
  type: 'text' | 'password';
};

const PROVIDER_FIELDS: Record<string, ProviderField[]> = {
  google: [
    {
      name: 'clientId',
      label: 'Client ID',
      placeholder: 'xxx.apps.googleusercontent.com',
      type: 'text',
    },
    { name: 'clientSecret', label: 'Client Secret', placeholder: 'GOCSPX-...', type: 'password' },
  ],
  github: [
    { name: 'clientId', label: 'Client ID', placeholder: 'Ov23li...', type: 'text' },
    { name: 'clientSecret', label: 'Client Secret', placeholder: 'secret...', type: 'password' },
  ],
  slack: [
    { name: 'clientId', label: 'Client ID', placeholder: '1234567890.123456', type: 'text' },
    { name: 'clientSecret', label: 'Client Secret', placeholder: 'secret...', type: 'password' },
  ],
  notion: [
    { name: 'clientId', label: 'Client ID', placeholder: 'abc123...', type: 'text' },
    { name: 'clientSecret', label: 'Client Secret', placeholder: 'secret...', type: 'password' },
  ],
  dropbox: [
    { name: 'clientId', label: 'Client ID', placeholder: 'abc123...', type: 'text' },
    { name: 'clientSecret', label: 'Client Secret', placeholder: 'secret...', type: 'password' },
  ],
  zoom: [
    { name: 'clientId', label: 'Client ID', placeholder: 'abc123...', type: 'text' },
    { name: 'clientSecret', label: 'Client Secret', placeholder: 'secret...', type: 'password' },
  ],
  clickup: [
    { name: 'clientId', label: 'Client ID', placeholder: 'abc123...', type: 'text' },
    { name: 'clientSecret', label: 'Client Secret', placeholder: 'secret...', type: 'password' },
  ],
  discord: [
    {
      name: 'webhookUrl',
      label: 'Webhook URL',
      placeholder: 'https://discord.com/api/webhooks/...',
      type: 'text',
    },
  ],
  stripe: [{ name: 'apiKey', label: 'API Key', placeholder: 'sk_live_...', type: 'password' }],
  openai: [{ name: 'apiKey', label: 'API Key', placeholder: 'sk-...', type: 'password' }],
  nvidia: [{ name: 'apiKey', label: 'API Key', placeholder: 'nvapi-...', type: 'password' }],
  gemini: [{ name: 'apiKey', label: 'API Key', placeholder: 'AIza...', type: 'password' }],
  anthropic: [{ name: 'apiKey', label: 'API Key', placeholder: 'sk-ant-...', type: 'password' }],
  whatsapp: [
    { name: 'accessToken', label: 'Access Token', placeholder: 'EAA...', type: 'password' },
    {
      name: 'webhookUrl',
      label: 'Webhook Verify Token',
      placeholder: 'your-verify-token',
      type: 'text',
    },
  ],
  serpapi: [
    { name: 'apiKey', label: 'API Key', placeholder: 'your-serpapi-key', type: 'password' },
  ],
  elevenlabs: [
    { name: 'apiKey', label: 'API Key', placeholder: 'your-elevenlabs-key', type: 'password' },
  ],
};

const PROVIDER_LABELS: Record<string, string> = {
  google: 'Google (Gmail, Drive, Calendar, Docs, Sheets, Slides, Tasks, Contacts)',
  github: 'GitHub',
  slack: 'Slack',
  notion: 'Notion',
  dropbox: 'Dropbox',
  zoom: 'Zoom',
  clickup: 'ClickUp',
  discord: 'Discord',
  stripe: 'Stripe',
  openai: 'OpenAI',
  nvidia: 'NVIDIA',
  gemini: 'Gemini',
  anthropic: 'Anthropic',
  whatsapp: 'WhatsApp Business',
  serpapi: 'SerpAPI (Job Search)',
  elevenlabs: 'ElevenLabs (Voice)',
};

const PROVIDER_DESCRIPTIONS: Record<string, string> = {
  google:
    'Create OAuth credentials at console.cloud.google.com → APIs & Services → Credentials. Add http://localhost:3000/api/v1/integrations/google/callback as authorized redirect URI.',
  github:
    'Create an OAuth App at github.com/settings/developers → OAuth Apps. Set callback URL to http://localhost:3000/api/v1/integrations/github/callback.',
  slack:
    'Create an app at api.slack.com/apps → Create New App → OAuth & Permissions. Set redirect URI to http://localhost:3000/api/v1/integrations/slack/callback.',
  notion:
    'Create an integration at notion.so/my-integrations. Set redirect URI to http://localhost:3000/api/v1/integrations/notion/callback.',
  dropbox:
    'Create an app at dropbox.com/developers/apps → Create app → Scoped access. Set redirect URI to http://localhost:3000/api/v1/integrations/dropbox/callback.',
  zoom: 'Create a Server-to-Server OAuth app at marketplace.zoom.us → Develop → Build App. Set redirect URL to http://localhost:3000/api/v1/integrations/zoom/callback.',
  clickup:
    'Create an OAuth app at clickup.com/apps. Set redirect URI to http://localhost:3000/api/v1/integrations/clickup/callback.',
  discord:
    'Create a webhook in your Discord server: Server Settings → Integrations → Webhooks → New Webhook.',
  stripe: 'Get your API key from dashboard.stripe.com → Developers → API keys.',
  openai: 'Get your API key from platform.openai.com → API keys.',
  nvidia: 'Get your API key from build.nvidia.com → API catalog.',
  gemini: 'Get your API key from aistudio.google.com → Get API key.',
  anthropic: 'Get your API key from console.anthropic.com → API keys.',
  whatsapp: 'Set up WhatsApp Business API at developers.facebook.com → WhatsApp → Getting Started.',
  serpapi: 'Get your API key from serpapi.com → Manage API key.',
  elevenlabs: 'Get your API key from elevenlabs.io → Profile → API Key.',
};

type ProviderConfigCardProps = {
  providerId: string;
  status: AdminCredentialStatus | null;
  onSaved: (providerId: string) => void;
  onDeleted: (providerId: string) => void;
};

function ProviderConfigCard({
  providerId,
  status,
  onSaved,
  onDeleted,
}: ProviderConfigCardProps): React.JSX.Element {
  const fields = PROVIDER_FIELDS[providerId] ?? [];
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const isConfigured = status
    ? status.hasClientId || status.hasApiKey || status.hasWebhookUrl || status.hasAccessToken
    : false;

  const handleSave = useCallback(async () => {
    setSaving(true);
    setMessage(null);
    try {
      const filled: Record<string, string> = {};
      for (const field of fields) {
        const val = values[field.name];
        if (val && val.trim() !== '') {
          filled[field.name] = val.trim();
        }
      }
      if (Object.keys(filled).length === 0) {
        setMessage({ type: 'error', text: 'Enter at least one credential value.' });
        return;
      }
      await saveAdminCredential(providerId, filled);
      setValues({});
      setMessage({ type: 'success', text: 'Credentials saved.' });
      onSaved(providerId);
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to save.' });
    } finally {
      setSaving(false);
    }
  }, [providerId, values, fields, onSaved]);

  const handleDelete = useCallback(async () => {
    setDeleting(true);
    setMessage(null);
    try {
      await deleteAdminCredential(providerId);
      setMessage({ type: 'success', text: 'Credentials deleted.' });
      onDeleted(providerId);
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to delete.' });
    } finally {
      setDeleting(false);
    }
  }, [providerId, onDeleted]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg">{PROVIDER_LABELS[providerId] ?? providerId}</CardTitle>
            <CardDescription className="mt-1">{PROVIDER_DESCRIPTIONS[providerId]}</CardDescription>
          </div>
          {isConfigured ? (
            <Badge variant="default" className="bg-green-600">
              <Check className="mr-1 h-3 w-3" /> Configured
            </Badge>
          ) : (
            <Badge variant="secondary">Not configured</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {fields.map((field) => (
            <div key={field.name} className="space-y-2">
              <Label htmlFor={`${providerId}-${field.name}`}>{field.label}</Label>
              <Input
                id={`${providerId}-${field.name}`}
                type={field.type}
                placeholder={
                  isConfigured
                    ? `•••••••• (saved ${new Date(status?.updatedAt ?? '').toLocaleDateString()})`
                    : field.placeholder
                }
                value={values[field.name] ?? ''}
                onChange={(e) => setValues((prev) => ({ ...prev, [field.name]: e.target.value }))}
              />
            </div>
          ))}

          {message && (
            <p
              className={`text-sm ${message.type === 'error' ? 'text-red-500' : 'text-green-500'}`}
            >
              {message.text}
            </p>
          )}

          <div className="flex gap-2">
            <Button onClick={handleSave} disabled={saving} size="sm">
              {saving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              Save
            </Button>
            {isConfigured && (
              <Button variant="destructive" onClick={handleDelete} disabled={deleting} size="sm">
                {deleting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="mr-2 h-4 w-4" />
                )}
                Delete
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function AdminIntegrationsPage(): React.JSX.Element {
  const [credentials, setCredentials] = useState<Record<string, AdminCredentialStatus>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const data = await listAdminCredentials();
      setCredentials(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load credentials');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSaved = useCallback((providerId: string) => {
    setCredentials((prev) => ({
      ...prev,
      [providerId]: {
        hasClientId: true,
        hasClientSecret: true,
        hasApiKey: false,
        hasWebhookUrl: false,
        hasAccessToken: false,
        updatedAt: new Date().toISOString(),
      },
    }));
  }, []);

  const handleDeleted = useCallback((providerId: string) => {
    setCredentials((prev) => {
      const next = { ...prev };
      delete next[providerId];
      return next;
    });
  }, []);

  const allProviders = Object.keys(PROVIDER_FIELDS);

  return (
    <RequireAuth>
      <div className="container mx-auto max-w-4xl px-4 py-10">
        <div className="mb-8">
          <Link
            href="/settings"
            className="mb-4 inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="mr-1 h-4 w-4" /> Back to Settings
          </Link>
          <h1 className="text-3xl font-bold tracking-tight">Integration Credentials</h1>
          <p className="mt-1 text-muted-foreground">
            Configure API keys, OAuth credentials, and webhook URLs for all third-party services.
            Admin only.
          </p>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        )}

        {error && (
          <Card className="mb-6 border-red-500">
            <CardContent className="py-4">
              <p className="text-sm text-red-500">{error}</p>
            </CardContent>
          </Card>
        )}

        {!loading && (
          <div className="space-y-6">
            {allProviders.map((providerId) => (
              <ProviderConfigCard
                key={providerId}
                providerId={providerId}
                status={credentials[providerId] ?? null}
                onSaved={handleSaved}
                onDeleted={handleDeleted}
              />
            ))}
          </div>
        )}
      </div>
    </RequireAuth>
  );
}

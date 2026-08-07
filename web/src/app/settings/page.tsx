import { AiProvidersCard } from '@/components/ai-providers-card';
import { IntegrationHub } from '@/components/integration-hub';
import { RequireAuth } from '@/components/require-auth';
import { ShortcutsCard } from '@/components/shortcuts-card';
import { VoiceSettingsCard } from '@/components/voice-settings-card';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function SettingsPage(): React.JSX.Element {
  return (
    <RequireAuth>
      <div className="container mx-auto max-w-6xl px-4 py-10">
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
          <p className="mt-1 text-muted-foreground">Manage your account and preferences.</p>
        </div>

        <div className="mb-8">
          <ShortcutsCard />
        </div>

        <div className="mb-8">
          <VoiceSettingsCard />
        </div>

        <div className="mb-10">
          <IntegrationHub />
        </div>

        <div className="mb-8">
          <AiProvidersCard />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
            <CardDescription>
              Profile editing and preferences will be available in a future milestone.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Your account is authenticated and connected to the BRO backend.
            </p>
          </CardContent>
        </Card>
      </div>
    </RequireAuth>
  );
}

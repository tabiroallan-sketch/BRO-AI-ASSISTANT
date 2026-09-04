import { AiProvidersCard } from '@/components/ai-providers-card';
import { IntegrationHub } from '@/components/integration-hub';
import { ProfileCard } from '@/components/profile-card';
import { RequireAuth } from '@/components/require-auth';
import { ShortcutsCard } from '@/components/shortcuts-card';
import { VoiceSettingsCard } from '@/components/voice-settings-card';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { Settings } from 'lucide-react';

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
          <ProfileCard />
        </div>

        <div className="mb-8">
          <VoiceSettingsCard />
        </div>

        <div className="mb-10">
          <IntegrationHub />
          <div className="mt-4">
            <Link href="/settings/integrations">
              <Button variant="outline" size="sm">
                <Settings className="mr-2 h-4 w-4" />
                Configure Integration Credentials (Admin)
              </Button>
            </Link>
          </div>
        </div>

        <div className="mb-8">
          <AiProvidersCard />
        </div>
      </div>
    </RequireAuth>
  );
}

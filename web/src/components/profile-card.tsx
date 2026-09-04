'use client';

import * as React from 'react';
import { Check, Loader2 } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function ProfileCard(): React.JSX.Element {
  const { user, updateProfile } = useAuth();
  const [displayName, setDisplayName] = React.useState(user?.displayName ?? '');
  const [avatarUrl, setAvatarUrl] = React.useState(user?.avatarUrl ?? '');
  const [saving, setSaving] = React.useState(false);
  const [message, setMessage] = React.useState<{ ok: boolean; text: string } | null>(null);

  React.useEffect(() => {
    setDisplayName(user?.displayName ?? '');
    setAvatarUrl(user?.avatarUrl ?? '');
  }, [user]);

  React.useEffect(() => {
    if (!message) {
      return;
    }
    const timer = setTimeout(() => setMessage(null), 4000);
    return () => clearTimeout(timer);
  }, [message]);

  const hasChanges =
    displayName.trim() !== (user?.displayName ?? '') ||
    avatarUrl.trim() !== (user?.avatarUrl ?? '');

  const onSubmit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (!user) {
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      await updateProfile({
        displayName: displayName.trim() === '' ? null : displayName.trim(),
        avatarUrl: avatarUrl.trim() === '' ? null : avatarUrl.trim(),
      });
      setMessage({ ok: true, text: 'Profile saved.' });
    } catch (error) {
      setMessage({
        ok: false,
        text: error instanceof Error ? error.message : 'Failed to save profile.',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile</CardTitle>
        <CardDescription>Update your display name and avatar.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="profile-email">Email</Label>
            <Input id="profile-email" value={user?.email ?? ''} disabled readOnly />
            <p className="text-xs text-muted-foreground">
              Your email is used to log in and cannot be changed here.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="profile-display-name">Display name</Label>
            <Input
              id="profile-display-name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="Your name"
              maxLength={100}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="profile-avatar-url">Avatar URL</Label>
            <Input
              id="profile-avatar-url"
              value={avatarUrl}
              onChange={(event) => setAvatarUrl(event.target.value)}
              placeholder="https://example.com/avatar.png"
              maxLength={2048}
              type="url"
            />
            <p className="text-xs text-muted-foreground">
              An optional image URL used as your avatar.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Button type="submit" size="sm" disabled={saving || !hasChanges}>
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              {saving ? 'Saving…' : 'Save changes'}
            </Button>
            {message ? (
              <span className={`text-sm ${message.ok ? 'text-emerald-500' : 'text-destructive'}`}>
                {message.text}
              </span>
            ) : null}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

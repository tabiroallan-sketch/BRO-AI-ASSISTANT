'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2, ShieldAlert, ShieldCheck } from 'lucide-react';
import { DashboardPageHeader } from '@/components/dashboard-page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  getAuditLogs,
  listUsers,
  updateUser,
  type AdminUser,
  type AuditEvent,
} from '@/lib/dashboard';

export default function AdminPage(): React.JSX.Element {
  const router = useRouter();
  const { user, logout } = useAuth();
  const [users, setUsers] = React.useState<AdminUser[] | null>(null);
  const [audit, setAudit] = React.useState<AuditEvent[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [savingId, setSavingId] = React.useState<string | null>(null);

  async function load(): Promise<void> {
    try {
      const [userList, auditEvents] = await Promise.all([listUsers(), getAuditLogs()]);
      setUsers(userList);
      setAudit(auditEvents);
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        await logout();
        router.replace('/login');
        return;
      }
      if (err instanceof ApiError && err.status === 403) {
        setError('You do not have permission to view this page.');
        return;
      }
      setError('Failed to load admin data.');
    }
  }

  React.useEffect(() => {
    if (user?.role === 'ADMIN') {
      void load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.role]);

  async function handleUpdate(
    id: string,
    data: { role?: 'USER' | 'ADMIN'; isActive?: boolean },
  ): Promise<void> {
    setSavingId(id);
    setError(null);
    try {
      const updated = await updateUser(id, data);
      setUsers((current) =>
        current === null ? current : current.map((entry) => (entry.id === id ? updated : entry)),
      );
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        await logout();
        router.replace('/login');
        return;
      }
      setError(err instanceof ApiError ? err.message : 'Failed to update user.');
    } finally {
      setSavingId(null);
    }
  }

  if (user === null || user.role !== 'ADMIN') {
    return (
      <div>
        <DashboardPageHeader title="Admin" />
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-12 text-center">
            <ShieldAlert className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              You do not have permission to view this page.
            </p>
            <Button variant="outline" size="sm" asChild>
              <Link href="/dashboard">Back to dashboard</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <DashboardPageHeader
        title="Admin"
        description="Manage users and review security-relevant activity."
      />

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      {users === null || audit === null ? (
        <div className="flex min-h-[30vh] items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-6">
          <Card>
            <CardContent className="p-4">
              <div className="mb-3 flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-semibold">Users ({users.length})</h2>
              </div>
              <ul className="divide-y divide-border">
                {users.map((entry) => (
                  <li
                    key={entry.id}
                    className="flex flex-wrap items-center justify-between gap-3 py-3"
                  >
                    <div className="min-w-0">
                      <p className="break-all text-sm font-medium">
                        {entry.displayName ?? entry.email}
                      </p>
                      <p className="break-all text-xs text-muted-foreground">{entry.email}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={entry.isActive ? 'secondary' : 'destructive'}>
                        {entry.isActive ? 'active' : 'disabled'}
                      </Badge>
                      <select
                        aria-label={`Role for ${entry.email}`}
                        value={entry.role}
                        disabled={savingId === entry.id}
                        onChange={(event) =>
                          void handleUpdate(entry.id, {
                            role: event.target.value as 'USER' | 'ADMIN',
                          })
                        }
                        className="h-8 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
                      >
                        <option value="USER">User</option>
                        <option value="ADMIN">Admin</option>
                      </select>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={savingId === entry.id}
                        onClick={() => void handleUpdate(entry.id, { isActive: !entry.isActive })}
                      >
                        {entry.isActive ? 'Disable' : 'Enable'}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="mb-3">
                <h2 className="text-sm font-semibold">Audit log ({audit.length})</h2>
              </div>
              {audit.length === 0 ? (
                <p className="text-sm text-muted-foreground">No audit events recorded.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {audit.map((event) => (
                    <li key={event.id} className="py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className="font-mono">
                          {event.action}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {new Date(event.at).toLocaleString()}
                        </span>
                        {event.actorEmail && (
                          <span className="text-xs text-muted-foreground">
                            by {event.actorEmail}
                          </span>
                        )}
                      </div>
                      {event.detail && (
                        <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
                          {event.detail}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

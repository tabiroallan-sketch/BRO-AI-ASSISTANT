import * as React from 'react';
import { AiOsShell } from '@/components/ai-os/ai-os-shell';
import { DashboardSidebar } from '@/components/dashboard-sidebar';
import { RequireAuth } from '@/components/require-auth';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <RequireAuth>
      <AiOsShell sidebar={<DashboardSidebar />}>{children}</AiOsShell>
    </RequireAuth>
  );
}

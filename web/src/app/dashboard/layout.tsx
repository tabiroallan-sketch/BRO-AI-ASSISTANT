import * as React from 'react';
import { RequireAuth } from '@/components/require-auth';
import { DashboardSidebar } from '@/components/dashboard-sidebar';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <RequireAuth>
      <div className="container mx-auto max-w-6xl px-4 py-8">
        <div className="flex flex-col gap-6 md:flex-row md:gap-8">
          <DashboardSidebar />
          <main className="min-w-0 flex-1">{children}</main>
        </div>
      </div>
    </RequireAuth>
  );
}

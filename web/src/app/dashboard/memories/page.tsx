'use client';

import * as React from 'react';
import { DashboardPageHeader } from '@/components/dashboard-page-header';
import { MemoriesManager } from '@/components/memories-manager';

export default function DashboardMemoriesPage(): React.JSX.Element {
  return (
    <div>
      <DashboardPageHeader
        title="Memories"
        description="Facts BRO remembers about you and uses to personalize every conversation."
      />
      <MemoriesManager />
    </div>
  );
}

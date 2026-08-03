'use client';

import * as React from 'react';
import { RequireAuth } from '@/components/require-auth';
import { MemoriesManager } from '@/components/memories-manager';

export default function MemoriesPage(): React.JSX.Element {
  return (
    <RequireAuth>
      <div className="container mx-auto max-w-6xl px-4 py-10">
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">Memories</h1>
          <p className="mt-1 text-muted-foreground">
            Facts BRO remembers about you and uses to personalize every conversation.
          </p>
        </div>

        <MemoriesManager />
      </div>
    </RequireAuth>
  );
}

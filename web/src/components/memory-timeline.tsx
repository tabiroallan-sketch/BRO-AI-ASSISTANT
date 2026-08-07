'use client';

import * as React from 'react';
import { History } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MEMORY_KIND_LABELS, type MemoryTimelineGroup } from '@/lib/memories';

export function MemoryTimeline({
  groups,
  onSelect,
}: {
  groups: MemoryTimelineGroup[];
  onSelect: (memoryId: string) => void;
}): React.JSX.Element {
  if (groups.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-4 w-4" />
            Timeline
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="py-8 text-center text-sm text-muted-foreground">
            No memories yet. Add one to start a timeline.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {groups.map((group) => (
        <section key={group.label}>
          <h3 className="mb-2 text-sm font-semibold text-muted-foreground">{group.label}</h3>
          <div className="space-y-3">
            {group.items.map((item) => (
              <button
                type="button"
                key={item.id}
                onClick={() => onSelect(item.id)}
                className="flex w-full flex-col gap-1 rounded-lg border bg-card p-4 text-left transition-colors hover:bg-accent/50"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{item.key}</span>
                  <Badge variant="secondary">{MEMORY_KIND_LABELS[item.kind]}</Badge>
                  {item.category && <Badge variant="outline">{item.category}</Badge>}
                  <Badge variant="outline">importance {item.importance}</Badge>
                </div>
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">{item.value}</p>
                <p className="text-xs text-muted-foreground/70">
                  {item.activity === 'accessed' ? 'Last recalled' : 'Last updated'} on{' '}
                  {new Date(item.lastAccessedAt ?? item.updatedAt).toLocaleString()}
                </p>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

'use client';

import { motion } from 'framer-motion';
import { useAiState, AI_STATE_COLORS, AI_STATE_LABELS } from '@/lib/ai-state';
import { cn } from '@/lib/utils';

/** Live AI core state, task progress and active tool for the floating HUD. */
export function CorePanelContent(): React.JSX.Element {
  const { state, taskProgress, activeTool } = useAiState();

  return (
    <div className="space-y-3">
      <div
        className={cn(
          'flex items-center gap-2 font-mono text-xs font-semibold uppercase tracking-widest',
          AI_STATE_COLORS[state],
        )}
      >
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
        {AI_STATE_LABELS[state]}
      </div>
      <div>
        <div className="mb-1 flex items-center justify-between font-mono text-[11px]">
          <span className="text-muted-foreground">TASK PROGRESS</span>
          <span className="font-semibold tabular-nums text-foreground">
            {Math.round(taskProgress * 100)}%
          </span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-foreground/10">
          <motion.div
            className="h-full rounded-full bg-gradient-to-r from-neon-cyan to-neon-purple"
            animate={{ width: `${Math.round(taskProgress * 100)}%` }}
            transition={{ duration: 0.4, ease: 'easeOut' }}
          />
        </div>
      </div>
      <div className="flex items-center justify-between font-mono text-[11px]">
        <span className="text-muted-foreground">ACTIVE TOOL</span>
        <span className={cn('font-semibold', activeTool ? 'text-neon-cyan' : 'text-foreground/60')}>
          {activeTool ?? 'none'}
        </span>
      </div>
    </div>
  );
}

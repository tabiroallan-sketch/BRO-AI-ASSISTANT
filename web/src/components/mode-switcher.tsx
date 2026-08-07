'use client';

import { Laptop, MonitorUp, Mic, type LucideIcon } from 'lucide-react';
import { useOperatingMode } from '@/hooks/use-operating-mode';
import { OPERATING_MODE_LABELS, OPERATING_MODES, type OperatingMode } from '@/lib/desktop';
import { cn } from '@/lib/utils';

const MODE_ICONS: Record<OperatingMode, LucideIcon> = {
  desktop: Laptop,
  overlay: MonitorUp,
  voice: Mic,
};

/**
 * Instant operating-mode switch (Stage 12). Three modes — Desktop / Overlay /
 * Voice — shared across every window and the tray. Clicking one switches the
 * desktop shell immediately; in a plain browser it just navigates the current
 * window to the matching surface.
 */
export function ModeSwitcher({
  compact = false,
  className,
}: {
  compact?: boolean;
  className?: string;
}): React.JSX.Element {
  const { mode, setMode } = useOperatingMode();

  return (
    <div
      role="radiogroup"
      aria-label="Operating mode"
      className={cn(
        'inline-flex items-center gap-0.5 rounded-full border border-white/10 bg-foreground/5 p-0.5',
        className,
      )}
    >
      {OPERATING_MODES.map((item) => {
        const Icon = MODE_ICONS[item];
        const active = mode === item;
        return (
          <button
            key={item}
            type="button"
            role="radio"
            aria-checked={active}
            title={OPERATING_MODE_LABELS[item]}
            onClick={() => setMode(item)}
            className={cn(
              'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-all duration-300',
              active
                ? 'bg-neon-cyan/15 text-neon-cyan shadow-[0_0_14px_-4px_var(--neon-cyan)]'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {!compact && <span>{OPERATING_MODE_LABELS[item]}</span>}
          </button>
        );
      })}
    </div>
  );
}

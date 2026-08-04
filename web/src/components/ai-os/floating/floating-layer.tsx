'use client';

import * as React from 'react';
import { Plus } from 'lucide-react';
import { CorePanelContent } from './core-panel';
import { FloatingPanel } from './floating-panel';
import { TelemetryPanelContent } from './telemetry-panel';
import { StatusPanelContent } from '@/components/ai-os/status/status-panel';
import { useHud, type PanelId } from '@/lib/hud-state';

interface PanelDef {
  id: PanelId;
  title: string;
  accent: string;
}

const PANELS: PanelDef[] = [
  { id: 'telemetry', title: 'Telemetry', accent: 'text-neon-cyan' },
  { id: 'core', title: 'Core', accent: 'text-neon-purple' },
  { id: 'status', title: 'Status', accent: 'text-emerald-400' },
];

function initialPosition(index: number): { x: number; y: number } {
  const width = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const height = typeof window !== 'undefined' ? window.innerHeight : 800;
  if (index === 0) {
    return { x: 16, y: 76 };
  }
  if (index === 1) {
    return { x: width - 264 - 16, y: 76 };
  }
  return { x: 16, y: height - 300 };
}

/**
 * HUD layer of floating glass panels over the WebGL stage. Renders only after
 * mount (positions depend on viewport size, avoiding SSR hydration mismatch).
 * Closed panels collapse into a small reopen cluster in the bottom-left.
 */
export function FloatingLayer(): React.JSX.Element | null {
  const [ready, setReady] = React.useState(false);
  const { panels, togglePanel } = useHud();
  const [positions, setPositions] = React.useState<Record<
    PanelId,
    { x: number; y: number }
  > | null>(null);

  React.useEffect(() => {
    setPositions({
      telemetry: initialPosition(0),
      core: initialPosition(1),
      status: initialPosition(2),
    });
    setReady(true);
  }, []);

  if (!ready || !positions) {
    return null;
  }

  const closed = PANELS.filter((panel) => !panels[panel.id]);

  return (
    <div className="pointer-events-none absolute inset-0 z-20 hidden md:block">
      {PANELS.map((panel, index) =>
        panels[panel.id] ? (
          <FloatingPanel
            key={panel.id}
            title={panel.title}
            accent={panel.accent}
            defaultPosition={positions[panel.id] ?? initialPosition(index)}
            onClose={() => togglePanel(panel.id)}
          >
            {panel.id === 'telemetry' ? (
              <TelemetryPanelContent />
            ) : panel.id === 'status' ? (
              <StatusPanelContent />
            ) : (
              <CorePanelContent />
            )}
          </FloatingPanel>
        ) : null,
      )}

      {closed.length > 0 && (
        <div className="pointer-events-auto absolute bottom-4 left-4 flex flex-col gap-2">
          {closed.map((panel) => (
            <button
              key={panel.id}
              type="button"
              onClick={() => togglePanel(panel.id)}
              aria-label={`Reopen ${panel.title} panel`}
              title={`Reopen ${panel.title}`}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-background/55 text-muted-foreground shadow-[0_0_16px_color-mix(in_oklab,var(--neon-cyan)_15%,transparent)] backdrop-blur-xl transition-colors hover:text-foreground"
            >
              <Plus className="h-4 w-4" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

'use client';

import { motion } from 'framer-motion';
import { useSystemStatus } from '@/lib/system';

function Row({
  label,
  value,
  ratio,
}: {
  label: string;
  value: string;
  ratio: number | null;
}): React.JSX.Element {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between font-mono text-[11px]">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-semibold tabular-nums text-foreground">{value}</span>
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-foreground/10">
        {ratio !== null && (
          <motion.div
            className="h-full rounded-full bg-gradient-to-r from-neon-cyan to-neon-blue"
            animate={{ width: `${Math.round(ratio * 100)}%` }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
          />
        )}
      </div>
    </div>
  );
}

/** Live system readouts for the floating HUD. */
export function TelemetryPanelContent(): React.JSX.Element {
  const { cpu, memory, online, latency } = useSystemStatus();

  const memoryLabel = memory === null ? '—' : `${Math.round(memory * 100)}%`;
  const latencyLabel = latency === null ? '—' : `${latency}ms`;

  return (
    <div className="space-y-3">
      <Row label="CPU LOAD" value={`${cpu}%`} ratio={cpu / 100} />
      <Row label="MEMORY" value={memoryLabel} ratio={memory} />
      <Row label="NETWORK" value={online ? 'ONLINE' : 'OFFLINE'} ratio={online ? 1 : 0} />
      <Row
        label="API LATENCY"
        value={latencyLabel}
        ratio={latency ? Math.min(1, latency / 100) : 0}
      />
    </div>
  );
}

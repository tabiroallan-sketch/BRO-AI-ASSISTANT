'use client';

import Link from 'next/link';
import {
  Activity,
  Cpu,
  Gauge,
  Globe,
  MemoryStick,
  Settings,
  Terminal,
  Wrench,
  Zap,
} from 'lucide-react';
import { NotificationsMenu } from '@/components/notifications-menu';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import { ModeSwitcher } from '@/components/mode-switcher';
import { useAiState, AI_STATE_COLORS, AI_STATE_LABELS } from '@/lib/ai-state';
import { useAuth } from '@/lib/auth';
import type { MicMode } from '@/lib/audio-engine';
import { useConsole } from '@/lib/console-state';
import { useSystemStatus } from '@/lib/system';
import { cn } from '@/lib/utils';

const CORE_MODEL = 'bro-core';

function Metric({
  icon: Icon,
  label,
  value,
  tone = 'text-foreground',
}: {
  icon: typeof Cpu;
  label: string;
  value: string;
  tone?: string;
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-2" title={label}>
      <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      <span className="font-mono text-xs text-muted-foreground">{label}</span>
      <span className={cn('font-mono text-xs font-semibold tabular-nums', tone)}>{value}</span>
    </div>
  );
}

/**
 * Top HUD strip for the AI OS shell.
 * Left: identity + live AI state. Middle: system telemetry.
 * Right: profile, settings, notifications, theme.
 */
export function StatusBar({ micMode }: { micMode: MicMode }): React.JSX.Element {
  const { cpu, memory, online, latency } = useSystemStatus();
  const { state, activeTool } = useAiState();
  const { user } = useAuth();

  const memoryLabel = memory === null ? '—' : `${Math.round(memory * 100)}%`;
  const latencyLabel = latency === null ? '—' : `${latency}ms`;
  const initialState = user?.displayName ?? user?.email ?? 'U';
  const voiceLabel = micMode === 'off' ? 'OFF' : micMode === 'live' ? 'LIVE' : 'SIM';
  const voiceTone =
    micMode === 'live'
      ? 'text-neon-cyan'
      : micMode === 'demo'
        ? 'text-neon-purple'
        : 'text-muted-foreground';

  return (
    <header className="sticky top-0 z-40 glass-strong">
      <div className="mx-auto flex h-12 w-full max-w-[90rem] items-center gap-4 px-4">
        <Link href="/dashboard" className="flex shrink-0 items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-neon-cyan opacity-60" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-neon-cyan shadow-[0_0_12px_var(--neon-cyan)]" />
          </span>
          <span className="text-sm font-semibold tracking-[0.2em] text-foreground">BRO</span>
        </Link>

        <div
          className={cn(
            'flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[11px] font-semibold uppercase tracking-widest',
            AI_STATE_COLORS[state],
          )}
          title="AI core state"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-current" />
          {AI_STATE_LABELS[state]}
        </div>

        <div className="hidden min-w-0 items-center gap-5 lg:flex">
          <Metric icon={Cpu} label="CPU" value={`${cpu}%`} />
          <Metric icon={MemoryStick} label="MEM" value={memoryLabel} />
          <Metric
            icon={Globe}
            label="NET"
            value={online ? 'ON' : 'OFF'}
            tone={online ? 'text-emerald-400' : 'text-red-400'}
          />
          <Metric icon={Gauge} label="LAT" value={latencyLabel} />
          <Metric icon={Zap} label="MODEL" value={CORE_MODEL} />
          <Metric
            icon={Wrench}
            label="TOOL"
            value={activeTool ?? '—'}
            tone={activeTool ? 'text-neon-cyan' : 'text-muted-foreground'}
          />
          <Metric icon={Activity} label="VOICE" value={voiceLabel} tone={voiceTone} />
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <ModeSwitcher className="mr-1 hidden sm:inline-flex" />
          <span className="hidden rounded border border-white/10 bg-foreground/5 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground lg:inline">
            Ctrl K
          </span>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => useConsole.getState().openConsole()}
            aria-label="Open command console"
            title="Command console (Ctrl+K)"
          >
            <Terminal className="h-5 w-5" />
          </Button>
          <Link href="/settings" aria-label="Settings">
            <Button variant="ghost" size="icon">
              <Settings className="h-5 w-5" />
            </Button>
          </Link>
          <NotificationsMenu />
          <ThemeToggle />
          <Link
            href="/settings"
            aria-label="Profile"
            className="flex h-8 w-8 items-center justify-center rounded-full border border-neon-cyan/40 bg-neon-cyan/10 text-xs font-semibold text-neon-cyan shadow-[0_0_14px_color-mix(in_oklab,var(--neon-cyan)_35%,transparent)]"
          >
            {initialState.charAt(0).toUpperCase()}
          </Link>
        </div>
      </div>
    </header>
  );
}

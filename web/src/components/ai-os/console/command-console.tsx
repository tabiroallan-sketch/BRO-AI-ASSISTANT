'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { motion, useReducedMotion } from 'framer-motion';
import {
  Activity,
  AlertTriangle,
  Brain,
  CheckCircle2,
  CircleDashed,
  Compass,
  Cpu,
  FileText,
  Gauge,
  HardDrive,
  LayoutDashboard,
  Maximize2,
  MessageSquare,
  Mic,
  Moon,
  Settings,
  Sun,
  type LucideIcon,
} from 'lucide-react';
import { useAiState, type AiState } from '@/lib/ai-state';
import { useConsole } from '@/lib/console-state';
import { useHud } from '@/lib/hud-state';
import { cn } from '@/lib/utils';

type Section = 'Navigate' | 'View' | 'Simulate' | 'System';

interface Command {
  id: string;
  title: string;
  keywords: string;
  section: Section;
  icon: LucideIcon;
  hint?: string;
  action: () => void;
}

function navigate(router: ReturnType<typeof useRouter>, path: string): () => void {
  return () => {
    router.push(path);
  };
}

function setDemoState(state: AiState): () => void {
  return () => {
    const ai = useAiState.getState();
    ai.setActiveTool(null);
    ai.setTaskProgress(0);
    ai.setState(state);
  };
}

function runDiagnostics(): void {
  const ai = useAiState.getState();
  ai.setState('executing');
  ai.setActiveTool('health-check');
  ai.setTaskProgress(0.05);
  let progress = 0.05;
  const timer = window.setInterval(() => {
    progress += 0.1 + Math.random() * 0.15;
    if (progress >= 1) {
      window.clearInterval(timer);
      ai.setTaskProgress(1);
      ai.setActiveTool(null);
      ai.setState('success');
      window.setTimeout(() => {
        if (useAiState.getState().state === 'success') {
          useAiState.getState().setState('idle');
        }
      }, 2400);
    } else {
      ai.setTaskProgress(progress);
    }
  }, 200);
}

function toggleFullscreen(): void {
  if (typeof document === 'undefined') {
    return;
  }
  if (document.fullscreenElement) {
    void document.exitFullscreen();
  } else {
    void document.documentElement.requestFullscreen();
  }
}

/**
 * Spotlight-style command console for the AI OS. Press Ctrl/Cmd+K (or the
 * terminal button in the status bar) to open, type to filter, arrows + Enter
 * to run. All commands act on the existing UI: navigation, HUD panels, theme,
 * the AI state machine and system actions — no backend changes.
 */
export function CommandConsole(): React.JSX.Element | null {
  const router = useRouter();
  const { open, closeConsole } = useConsole();
  const { togglePanel } = useHud();
  const { resolvedTheme, setTheme } = useTheme();
  const reduceMotion = useReducedMotion();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [query, setQuery] = React.useState('');
  const [index, setIndex] = React.useState(0);

  const commands = React.useMemo<Command[]>(() => {
    const go = (path: string): (() => void) => navigate(router, path);
    return [
      {
        id: 'go-dashboard',
        title: 'Open Dashboard',
        keywords: 'home main',
        section: 'Navigate',
        icon: LayoutDashboard,
        action: go('/dashboard'),
      },
      {
        id: 'go-chat',
        title: 'Open Chat',
        keywords: 'conversation talk',
        section: 'Navigate',
        icon: MessageSquare,
        action: go('/chat'),
      },
      {
        id: 'go-memories',
        title: 'Open Memories',
        keywords: 'memory recall',
        section: 'Navigate',
        icon: FileText,
        action: go('/memories'),
      },
      {
        id: 'go-settings',
        title: 'Open Settings',
        keywords: 'config preferences',
        section: 'Navigate',
        icon: Settings,
        action: go('/settings'),
      },

      {
        id: 'theme',
        title: 'Toggle Theme',
        keywords: 'dark light mode',
        section: 'View',
        icon: resolvedTheme === 'dark' ? Sun : Moon,
        hint: resolvedTheme === 'dark' ? 'to light' : 'to dark',
        action: () => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark'),
      },
      {
        id: 'panel-telemetry',
        title: 'Toggle Telemetry Panel',
        keywords: 'hud stats cpu',
        section: 'View',
        icon: Gauge,
        action: () => togglePanel('telemetry'),
      },
      {
        id: 'panel-core',
        title: 'Toggle Core Panel',
        keywords: 'hud state progress',
        section: 'View',
        icon: CircleDashed,
        action: () => togglePanel('core'),
      },
      {
        id: 'fullscreen',
        title: 'Toggle Fullscreen',
        keywords: 'maximize cinema',
        section: 'View',
        icon: Maximize2,
        action: toggleFullscreen,
      },

      {
        id: 'state-thinking',
        title: 'Core: Thinking',
        keywords: 'simulate brain',
        section: 'Simulate',
        icon: Brain,
        action: setDemoState('thinking'),
      },
      {
        id: 'state-executing',
        title: 'Core: Executing',
        keywords: 'simulate working tool',
        section: 'Simulate',
        icon: Cpu,
        action: setDemoState('executing'),
      },
      {
        id: 'state-listening',
        title: 'Core: Listening',
        keywords: 'simulate voice mic',
        section: 'Simulate',
        icon: Mic,
        action: setDemoState('listening'),
      },
      {
        id: 'state-success',
        title: 'Core: Success',
        keywords: 'simulate done ok',
        section: 'Simulate',
        icon: CheckCircle2,
        action: setDemoState('success'),
      },
      {
        id: 'state-warning',
        title: 'Core: Warning',
        keywords: 'simulate caution',
        section: 'Simulate',
        icon: AlertTriangle,
        action: setDemoState('warning'),
      },
      {
        id: 'state-error',
        title: 'Core: Error',
        keywords: 'simulate fail',
        section: 'Simulate',
        icon: AlertTriangle,
        action: setDemoState('error'),
      },
      {
        id: 'diagnostics',
        title: 'Run System Diagnostics',
        keywords: 'health check scan',
        section: 'System',
        icon: Activity,
        action: runDiagnostics,
      },
      {
        id: 'storage',
        title: 'Storage',
        keywords: 'disks space',
        section: 'System',
        icon: HardDrive,
        hint: 'coming soon',
        action: () => undefined,
      },
      {
        id: 'explore',
        title: 'Explore',
        keywords: 'search files find',
        section: 'System',
        icon: Compass,
        hint: 'coming soon',
        action: () => undefined,
      },
    ];
  }, [router, resolvedTheme, setTheme, togglePanel]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return commands;
    }
    return commands.filter(
      (command) =>
        command.title.toLowerCase().includes(q) || command.keywords.toLowerCase().includes(q),
    );
  }, [commands, query]);

  const sections = React.useMemo(() => {
    const out: Array<{ section: Section; commands: Command[] }> = [];
    for (const command of filtered) {
      const last = out[out.length - 1];
      if (last && last.section === command.section) {
        last.commands.push(command);
      } else {
        out.push({ section: command.section, commands: [command] });
      }
    }
    return out;
  }, [filtered]);

  React.useEffect(() => {
    setIndex(0);
  }, [query]);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        useConsole.getState().toggleConsole();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  React.useEffect(() => {
    if (open) {
      setQuery('');
      setIndex(0);
      const raf = window.requestAnimationFrame(() => inputRef.current?.focus());
      return () => window.cancelAnimationFrame(raf);
    }
    return undefined;
  }, [open]);

  if (!open) {
    return null;
  }

  const run = (command: Command): void => {
    command.action();
    closeConsole();
  };

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeConsole();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setIndex((i) => Math.min(filtered.length - 1, i + 1));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setIndex((i) => Math.max(0, i - 1));
      return;
    }
    if (event.key === 'Enter' && filtered[index]) {
      event.preventDefault();
      run(filtered[index]);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50"
      role="dialog"
      aria-modal="true"
      aria-label="Command console"
    >
      <button
        type="button"
        aria-label="Close command console"
        onClick={closeConsole}
        className="absolute inset-0 h-full w-full cursor-default bg-black/50 backdrop-blur-sm"
      />
      <motion.div
        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -16, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 420, damping: 32 }}
        className="glass-strong absolute left-1/2 top-[10%] w-[min(38rem,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-xl"
      >
        <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
          <span className="font-mono text-sm font-bold text-neon-cyan">&gt;</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Type a command…"
            aria-label="Command input"
            className="h-7 flex-1 bg-transparent font-mono text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
          <kbd className="hidden rounded border border-white/10 bg-foreground/5 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:block">
            ESC
          </kbd>
        </div>

        <div className="max-h-[50vh] overflow-y-auto py-1">
          {sections.length === 0 ? (
            <div className="px-4 py-6 text-center font-mono text-xs text-muted-foreground">
              No commands match “{query}”
            </div>
          ) : (
            sections.map(({ section, commands: group }) => (
              <React.Fragment key={section}>
                <div className="px-4 pb-1 pt-2 font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground/70">
                  {section}
                </div>
                {group.map((command) => {
                  const active = command === filtered[index];
                  const Icon = command.icon;
                  return (
                    <button
                      key={command.id}
                      type="button"
                      onMouseEnter={() => setIndex(filtered.indexOf(command))}
                      onClick={() => run(command)}
                      className={cn(
                        'flex w-full items-center gap-3 px-4 py-2 text-left text-sm transition-colors',
                        active ? 'bg-foreground/10 text-foreground' : 'text-foreground/80',
                      )}
                    >
                      <Icon
                        className={cn(
                          'h-4 w-4',
                          active ? 'text-neon-cyan' : 'text-muted-foreground',
                        )}
                      />
                      <span className="flex-1">{command.title}</span>
                      {command.hint && (
                        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                          {command.hint}
                        </span>
                      )}
                    </button>
                  );
                })}
              </React.Fragment>
            ))
          )}
        </div>

        <div className="flex items-center gap-3 border-t border-white/10 px-4 py-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          <span>↑↓ navigate</span>
          <span>↵ run</span>
          <span className="ml-auto">esc close</span>
        </div>
      </motion.div>
    </div>
  );
}

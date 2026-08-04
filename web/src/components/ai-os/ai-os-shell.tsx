'use client';

import * as React from 'react';
import { AiBackground } from '@/components/ai-os/background';
import { CommandConsole } from '@/components/ai-os/console/command-console';
import { FloatingLayer } from '@/components/ai-os/floating/floating-layer';
import { StatusToaster } from '@/components/ai-os/status/status-toaster';
import { StatusBar } from '@/components/ai-os/status-bar';
import AiScene from '@/components/ai-os/scene/ai-scene';
import { useAiState } from '@/lib/ai-state';
import { useStatusFeed } from '@/lib/status-feed';
import { useAudioReactivity } from '@/lib/use-audio-reactivity';

/**
 * Layout chrome of the AI operating system.
 * Top status bar, ambient WebGL stage, HUD overlays, optional side rail and a
 * content area. Later milestones slot the holographic sphere, tool panels and
 * command console into this shell without disturbing the page logic beneath.
 */
export function AiOsShell({
  sidebar,
  children,
}: {
  sidebar?: React.ReactNode;
  children: React.ReactNode;
}): React.JSX.Element {
  const { micMode } = useAudioReactivity();

  React.useEffect(() => {
    const unsubscribeAi = useAiState.subscribe((state, prevState) => {
      const next = state.state;
      if (next === prevState.state) {
        return;
      }
      const feed = useStatusFeed.getState();
      if (next === 'success') {
        feed.push('success', 'Task complete', 'Core returned to an idle state.');
      } else if (next === 'warning') {
        feed.push('warning', 'Attention required', 'Core flagged a potential issue.');
      } else if (next === 'error') {
        feed.push('error', 'Core fault', 'An operation did not complete cleanly.');
      } else if (next === 'executing') {
        feed.push('info', 'Executing', state.activeTool ? `Tool: ${state.activeTool}` : undefined);
      }
    });

    const markOnline = (): void => {
      useStatusFeed.getState().push('success', 'Network restored', 'Link to the API is live.');
    };
    const markOffline = (): void => {
      useStatusFeed.getState().push('error', 'Network lost', 'Cannot reach the API.');
    };
    window.addEventListener('online', markOnline);
    window.addEventListener('offline', markOffline);

    return () => {
      unsubscribeAi();
      window.removeEventListener('online', markOnline);
      window.removeEventListener('offline', markOffline);
    };
  }, []);

  return (
    <div className="relative flex min-h-dvh flex-col">
      <AiBackground />
      <AiScene />
      <FloatingLayer />
      <StatusToaster />
      <CommandConsole />
      <StatusBar micMode={micMode} />
      <div className="relative z-10 mx-auto flex w-full max-w-[90rem] flex-1 flex-col gap-4 px-4 pb-6 pt-4 md:flex-row">
        {sidebar && <aside className="w-full shrink-0 md:w-56">{sidebar}</aside>}
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}

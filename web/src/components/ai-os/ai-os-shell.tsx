'use client';

import * as React from 'react';
import { AiBackground } from '@/components/ai-os/background';
import { StatusBar } from '@/components/ai-os/status-bar';
import AiScene from '@/components/ai-os/scene/ai-scene';
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
  return (
    <div className="relative flex min-h-dvh flex-col">
      <AiBackground />
      <AiScene />
      <StatusBar micMode={micMode} />
      <div className="relative z-10 mx-auto flex w-full max-w-[90rem] flex-1 flex-col gap-4 px-4 pb-6 pt-4 md:flex-row">
        {sidebar && <aside className="w-full shrink-0 md:w-56">{sidebar}</aside>}
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}

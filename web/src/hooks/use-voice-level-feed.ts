'use client';

import * as React from 'react';
import { getVoiceEngine } from '@/lib/voice/engine';
import { getWakeWordEngine } from '@/lib/voice/wake-engine';
import { voiceLevel } from '@/lib/voice-level';

/**
 * Headless live-level feed for the WebGL core scene.
 *
 * Subscribes to the shared voice + wake engines and writes the current mic
 * level into the `voiceLevel` module without any React state, so the 3D core
 * pulses with the voice on any surface (dashboard included) with zero
 * re-renders. Safe to mount anywhere and at any time.
 */
export function useVoiceLevelFeed(): void {
  const engineRef = React.useRef(getVoiceEngine());
  const wakeRef = React.useRef(getWakeWordEngine());

  React.useEffect(() => {
    const engine = engineRef.current;
    const wake = wakeRef.current;

    const push = (): void => {
      const engineState = engine.getState();
      const wakeState = wake.getState();
      const listening = engineState.phase === 'requesting' || engineState.phase === 'listening';
      const hearing = wakeState.phase === 'hearing';
      voiceLevel.set(listening ? engineState.level : hearing ? wakeState.level : 0);
    };

    const offEngine = engine.subscribe(push);
    const offWake = wake.subscribe(push);
    push();

    return () => {
      offEngine();
      offWake();
    };
  }, []);
}

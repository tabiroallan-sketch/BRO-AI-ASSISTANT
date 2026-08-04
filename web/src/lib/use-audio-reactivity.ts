'use client';

import * as React from 'react';
import { audioEngine, type MicMode } from './audio-engine';

/**
 * Keeps the scene's audio reactivity alive: starts the demo signal on mount
 * (so the particle field and neural network visibly respond immediately) and
 * upgrades to the live microphone on the first user gesture.
 */
export function useAudioReactivity(): { micMode: MicMode } {
  const [micMode, setMicMode] = React.useState<MicMode>('off');

  React.useEffect(() => {
    audioEngine.startDemo();

    const upgrade = (): void => {
      audioEngine.requestLive();
      window.removeEventListener('pointerdown', upgrade);
      window.removeEventListener('keydown', upgrade);
    };
    window.addEventListener('pointerdown', upgrade);
    window.addEventListener('keydown', upgrade);

    const poll = window.setInterval(() => {
      setMicMode(audioEngine.getMicMode());
    }, 1200);

    return () => {
      window.clearInterval(poll);
      window.removeEventListener('pointerdown', upgrade);
      window.removeEventListener('keydown', upgrade);
    };
  }, []);

  return { micMode };
}

'use client';

import * as React from 'react';
import { getVoiceEngine, type EngineState, type VoiceEngine } from '@/lib/voice/engine';
import { initVoiceSettings } from '@/lib/voice/settings';
import { getDesktopApi } from '@/lib/desktop';
import { useAiState } from '@/lib/ai-state';

export type UseVoiceResult = {
  engine: VoiceEngine;
  state: EngineState;
  isListening: boolean;
  startManual: () => void;
  stop: () => void;
  toggleMic: () => void;
};

/**
 * Wires the shared voice engine (Stage 5) to the desktop shell and the
 * experiential AI state. Safe to use in multiple components at once: the
 * engine is a singleton and all entry points are idempotent.
 */
export function useVoice(): UseVoiceResult {
  const engineRef = React.useRef<VoiceEngine | null>(null);
  if (!engineRef.current) {
    engineRef.current = getVoiceEngine();
  }
  const engine = engineRef.current;

  const [state, setState] = React.useState<EngineState>(() => engine.getState());

  React.useEffect(() => engine.subscribe(setState), [engine]);

  // Load desktop voice settings once and keep the engine's mode in sync.
  React.useEffect(() => {
    let cancelled = false;
    void initVoiceSettings().then((settings) => {
      if (!cancelled) {
        engine.applySettings(settings);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [engine]);

  // Desktop driver wiring: global hotkeys (mic toggle, push-to-talk) and the
  // tray's start/stop listening commands.
  React.useEffect(() => {
    const api = getDesktopApi();
    if (!api) {
      return;
    }
    const offMicToggle = api.commands.onMicToggle(() => engine.onMicToggle());
    const offListeningStart = api.commands.onListeningStart(() => void engine.startManual());
    const offListeningStop = api.commands.onListeningStop(() => engine.stop());
    const offPttStart = api.commands.onPushToTalkStart(() => void engine.onPushToTalkStart());
    const offPttStop = api.commands.onPushToTalkStop(() => engine.onPushToTalkStop());
    return () => {
      offMicToggle();
      offListeningStart();
      offListeningStop();
      offPttStart();
      offPttStop();
    };
  }, [engine]);

  // Drive the orb / status from the engine phase. Never force 'idle' over a
  // streaming state — only reset when the current state is listening.
  React.useEffect(() => {
    if (state.phase === 'requesting' || state.phase === 'listening') {
      useAiState.getState().setState('listening');
    } else if (useAiState.getState().state === 'listening') {
      useAiState.getState().setState('idle');
    }
  }, [state.phase]);

  const isListening = state.phase === 'requesting' || state.phase === 'listening';

  return {
    engine,
    state,
    isListening,
    startManual: () => void engine.startManual(),
    stop: () => engine.stop(),
    toggleMic: () => engine.onMicToggle(),
  };
}

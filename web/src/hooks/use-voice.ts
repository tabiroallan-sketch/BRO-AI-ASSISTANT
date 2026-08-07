'use client';

import * as React from 'react';
import { getVoiceEngine, type EngineState, type VoiceEngine } from '@/lib/voice/engine';
import {
  applyExternalVoiceSettings,
  initVoiceSettings,
  saveVoiceSettings,
} from '@/lib/voice/settings';
import { getWakeWordEngine, type WakeState, type WakeWordEngine } from '@/lib/voice/wake-engine';
import { createWakeOwner } from '@/lib/voice/wake-owner';
import { getDesktopApi, normalizeVoiceSettings } from '@/lib/desktop';
import { useAiState } from '@/lib/ai-state';

export type UseVoiceResult = {
  engine: VoiceEngine;
  state: EngineState;
  isListening: boolean;
  startManual: () => void;
  stop: () => void;
  toggleMic: () => void;
  wakeEngine: WakeWordEngine;
  wake: WakeState;
  wakeOwner: boolean;
  setWakeWordEnabled: (enabled: boolean) => void;
};

/**
 * Wires the shared voice engine (Stage 5) and wake-word engine (Stage 6) to
 * the desktop shell and the experiential AI state. Safe to use in multiple
 * components at once: both engines are singletons and all entry points are
 * idempotent. The wake word runs in exactly one window at a time, decided by
 * a BroadcastChannel owner election.
 */
export function useVoice(): UseVoiceResult {
  const engineRef = React.useRef<VoiceEngine | null>(null);
  if (!engineRef.current) {
    engineRef.current = getVoiceEngine();
  }
  const engine = engineRef.current;

  const wakeRef = React.useRef<WakeWordEngine | null>(null);
  if (!wakeRef.current) {
    wakeRef.current = getWakeWordEngine();
  }
  const wakeEngine = wakeRef.current;

  const [state, setState] = React.useState<EngineState>(() => engine.getState());
  const [wake, setWake] = React.useState<WakeState>(() => wakeEngine.getState());
  const [wakeOwner, setWakeOwner] = React.useState(false);

  React.useEffect(() => engine.subscribe(setState), [engine]);
  React.useEffect(() => wakeEngine.subscribe(setWake), [wakeEngine]);

  // Load desktop voice settings once and keep both engines in sync.
  React.useEffect(() => {
    let cancelled = false;
    void initVoiceSettings().then((settings) => {
      if (!cancelled) {
        engine.applySettings(settings);
        wakeEngine.applySettings(settings);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [engine, wakeEngine]);

  // Reflect voice changes made in the other window (overlay / shell).
  React.useEffect(() => {
    const api = getDesktopApi();
    if (!api) {
      return;
    }
    return api.config.onChanged((config) => {
      const next = normalizeVoiceSettings(config.voice);
      if (next) {
        const applied = applyExternalVoiceSettings(next);
        engine.applySettings(applied);
        wakeEngine.applySettings(applied);
      }
    });
  }, [engine, wakeEngine]);

  // Desktop driver wiring: global hotkeys (mic toggle, push-to-talk), tray
  // listening commands, and the tray's wake-word toggle.
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
    const offWakeWordSet = api.commands.onWakeWordSet((enabled) => {
      void saveVoiceSettings({ wakeWordEnabled: enabled }).then((next) => {
        engine.applySettings(next);
        wakeEngine.applySettings(next);
      });
    });
    return () => {
      offMicToggle();
      offListeningStart();
      offListeningStop();
      offPttStart();
      offPttStop();
      offWakeWordSet();
    };
  }, [engine, wakeEngine]);

  // The wake engine runs only while the main engine is idle AND this window
  // owns the wake word (single-window election). Everything else pauses it.
  const listeningRef = React.useRef(false);
  listeningRef.current = state.phase === 'requesting' || state.phase === 'listening';
  React.useEffect(() => {
    const shouldRun = wakeOwner && !listeningRef.current && wake.enabled;
    if (shouldRun) {
      wakeEngine.resume();
    } else {
      wakeEngine.pause();
    }
  }, [state.phase, wakeOwner, wake.enabled, wakeEngine]);

  // Wake word heard -> start a manual utterance (respects the listening mode).
  React.useEffect(() => {
    if (wake.phase === 'triggered' && state.mode !== 'off') {
      void engine.startManual();
    }
  }, [wake.phase, wake.lastTriggerId, state.mode, engine]);

  // Single-window ownership election over BroadcastChannel.
  React.useEffect(() => {
    const owner = createWakeOwner();
    const offOwnership = owner.onOwnership(setWakeOwner);
    owner.start();
    return () => {
      offOwnership();
      owner.stop();
    };
  }, []);

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

  const setWakeWordEnabled = React.useCallback(
    (enabled: boolean) => {
      void saveVoiceSettings({ wakeWordEnabled: enabled }).then((next) => {
        engine.applySettings(next);
        wakeEngine.applySettings(next);
      });
    },
    [engine, wakeEngine],
  );

  return {
    engine,
    state,
    isListening,
    startManual: () => void engine.startManual(),
    stop: () => engine.stop(),
    toggleMic: () => engine.onMicToggle(),
    wakeEngine,
    wake,
    wakeOwner,
    setWakeWordEnabled,
  };
}

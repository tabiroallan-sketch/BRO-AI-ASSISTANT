/**
 * Wake-word engine (Stage 6): continuously listens for a phrase and, when it
 * is heard, hands control back to the main voice engine (manual capture).
 *
 * All browser APIs are injected through `WakeEngineDeps` and the clock is
 * injectable, so the whole state machine is unit-testable.
 *
 * CPU / false-positive strategy — the recognizer is energy-gated: a mic level
 * meter + VAD runs while armed, and the SpeechRecognition keyword recognizer
 * only starts while speech-like audio is present (with a short grace period
 * after silence so trailing words are caught). Quiet rooms and background
 * noise therefore cost almost nothing and can't trigger.
 */

import { createVad, type Vad, type VadOptions } from './vad';
import { createMicManager, type MicManager } from './mic';
import { currentVoiceSettings } from './settings';
import { playWakeChime, type ChimeContext } from './wake-feedback';
import {
  createWakeDetector,
  isWakeWordSupported,
  wakeThreshold,
  type WakeDetector,
  type WakeDetectorFactory,
} from './wake-detector';
import type { VoiceSettings } from '@/lib/desktop';

export type WakePhase = 'disabled' | 'armed' | 'hearing' | 'triggered' | 'paused' | 'error';

export type WakeState = {
  phase: WakePhase;
  enabled: boolean;
  /** Live mic level 0..1 while armed (drives the orb / card meter). */
  level: number;
  lastPhrase: string | null;
  lastConfidence: number;
  /** Increments on every trigger so UI animations can re-key. */
  lastTriggerId: number;
  /** Whether speech recognition is available in this environment. */
  supported: boolean;
  error: string | null;
};

export type WakeEngineDeps = {
  mic: MicManager;
  detectorFactory: WakeDetectorFactory;
  vadFactory: (options: VadOptions) => Vad;
  settings: () => VoiceSettings;
  /** Whether speech recognition is available; injectable for tests. */
  supported?: () => boolean;
  /** Fired when the wake word is detected (drives manual listening). */
  onWake?: (phrase: string, confidence: number) => void;
  /** Audible feedback; injected so tests can no-op it. */
  chime?: () => void;
  now?: () => number;
  sampleIntervalMs?: number;
  /** Re-arm delay after a trigger (default 4s). */
  cooldownMs?: number;
  /** How long the recognizer keeps running after voice activity ends. */
  graceMs?: number;
};

export const DEFAULT_WAKE_COOLDOWN_MS = 4_000;
export const DEFAULT_WAKE_GRACE_MS = 1_500;

export function createWakeState(enabled: boolean, supported: boolean): WakeState {
  return {
    // Always start unarmed; applySettings()/arm() drive the phase. An enabled
    // engine that lacks speech recognition surfaces its error immediately.
    phase: enabled && !supported ? 'error' : 'disabled',
    enabled,
    level: 0,
    lastPhrase: null,
    lastConfidence: 0,
    lastTriggerId: 0,
    supported,
    error: enabled && !supported ? 'Wake word needs a browser with speech recognition.' : null,
  };
}

export class WakeWordEngine {
  private state: WakeState;
  private readonly listeners = new Set<(state: WakeState) => void>();
  private readonly deps: WakeEngineDeps;
  private stream: MediaStream | null = null;
  private stopLevel: (() => void) | null = null;
  private vad: Vad | null = null;
  private detector: WakeDetector | null = null;
  private detectorOptions: {
    phrases: string[];
    sensitivity: number;
    onDetected: (detection: { phrase: string; confidence: number }) => void;
    onEnd: () => void;
  } | null = null;
  private paused = false;
  private arming = false;
  private vadActive = false;
  private wantDetector = false;
  private cooldownUntil = 0;
  private graceTimer: ReturnType<typeof setTimeout> | null = null;
  private rearmTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(deps: WakeEngineDeps) {
    this.deps = deps;
    const enabled = deps.settings().wakeWordEnabled;
    const supported = this.detectorSupported();
    this.state = createWakeState(enabled, supported);
  }

  getState(): WakeState {
    return this.state;
  }

  subscribe(listener: (state: WakeState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  isActive(): boolean {
    return this.state.phase === 'armed' || this.state.phase === 'hearing';
  }

  isPaused(): boolean {
    return this.paused;
  }

  private set(patch: Partial<WakeState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  private now(): number {
    return (this.deps.now ?? (() => Date.now()))();
  }

  private detectorSupported(): boolean {
    return (this.deps.supported ?? isWakeWordSupported)();
  }

  /** Applies the latest voice settings (enable state, phrases, sensitivity). */
  applySettings(settings: VoiceSettings): void {
    const supported = this.detectorSupported();
    if (this.detectorOptions) {
      this.detectorOptions.phrases = [...settings.wakeWordPhrases];
      this.detectorOptions.sensitivity = settings.wakeWordSensitivity;
    }
    if (!settings.wakeWordEnabled) {
      this.teardown();
      this.set({
        enabled: false,
        phase: 'disabled',
        supported,
        error: null,
        lastPhrase: null,
      });
      return;
    }
    if (!supported) {
      this.teardown();
      this.set({
        enabled: true,
        phase: 'error',
        supported,
        error: 'Wake word needs a browser with speech recognition.',
      });
      return;
    }
    const was = this.state;
    this.set({ enabled: true, supported, error: null });
    if (!was.enabled || was.phase === 'disabled' || was.phase === 'error') {
      if (this.paused) {
        this.set({ phase: 'paused' });
      } else {
        void this.arm();
      }
    }
  }

  /** Suspends the engine (e.g. while the main engine is actively listening). */
  pause(): void {
    this.paused = true;
    const wasActive = this.isActive();
    this.teardown();
    if (this.state.enabled && (wasActive || this.state.phase === 'triggered')) {
      this.set({ phase: 'paused' });
    }
  }

  /** Resumes the engine after pause(); respects the trigger cooldown. */
  resume(): void {
    this.paused = false;
    if (!this.state.enabled || !this.detectorSupported()) {
      return;
    }
    if (this.now() < this.cooldownUntil) {
      this.scheduleRearm();
      return;
    }
    void this.arm();
  }

  /** Permanently disables the engine (used on unmount). */
  stop(): void {
    this.teardown();
    this.set({ enabled: false, phase: 'disabled', level: 0 });
  }

  async arm(): Promise<void> {
    if (!this.state.enabled || this.paused || !this.detectorSupported()) {
      return;
    }
    if (this.arming || this.stream) {
      return;
    }
    if (this.now() < this.cooldownUntil) {
      this.scheduleRearm();
      return;
    }
    this.arming = true;
    this.set({ phase: 'armed', level: 0, error: null });

    const settings = this.deps.settings();
    try {
      const stream = await this.deps.mic.acquire({
        deviceId: settings.inputDeviceId,
        echoCancellation: settings.echoCancellation,
        noiseSuppression: settings.noiseSuppression,
        autoGainControl: settings.autoGainControl,
      });
      if (!this.state.enabled || this.paused) {
        this.arming = false;
        this.deps.mic.release();
        return;
      }
      this.stream = stream;

      this.detectorOptions = {
        phrases: [...settings.wakeWordPhrases],
        sensitivity: settings.wakeWordSensitivity,
        onDetected: (detection) => this.trigger(detection.phrase, detection.confidence),
        onEnd: () => this.onDetectorEnd(),
      };
      const detector = this.deps.detectorFactory(this.detectorOptions);
      if (!detector) {
        this.teardown();
        this.set({
          phase: 'error',
          supported: false,
          error: 'Wake word needs a browser with speech recognition.',
        });
        return;
      }
      this.detector = detector;
      this.arming = false;

      this.vad = this.deps.vadFactory({
        onSpeechStart: () => {
          this.vadActive = true;
          this.wantDetector = true;
          this.startDetector();
          if (this.state.phase === 'armed') {
            this.set({ phase: 'hearing' });
          }
        },
        onSpeechEnd: () => {
          this.vadActive = false;
          this.wantDetector = false;
          this.scheduleDetectorStop();
          if (this.state.phase === 'hearing') {
            this.set({ phase: 'armed' });
          }
        },
        now: this.now.bind(this),
      });

      this.stopLevel = this.deps.mic.levelMeter(
        stream,
        (level) => {
          this.vad?.feed(level);
          this.set({ level });
        },
        this.deps.sampleIntervalMs,
      );
    } catch (error) {
      this.arming = false;
      this.teardown();
      this.set({
        phase: 'error',
        error: error instanceof Error ? error.message : 'Could not access the microphone.',
      });
    }
  }

  private startDetector(): void {
    if (this.detector && this.wantDetector && !this.detector.isRunning()) {
      this.detector.start();
    }
  }

  private stopDetector(): void {
    this.wantDetector = false;
    this.detector?.stop();
  }

  private scheduleDetectorStop(): void {
    if (this.graceTimer) {
      clearTimeout(this.graceTimer);
    }
    const graceMs = this.deps.graceMs ?? DEFAULT_WAKE_GRACE_MS;
    this.graceTimer = setTimeout(() => {
      this.graceTimer = null;
      if (!this.vadActive && !this.wantDetector) {
        this.stopDetector();
      }
    }, graceMs);
  }

  private onDetectorEnd(): void {
    if (!this.state.enabled || this.paused) {
      return;
    }
    if (this.state.phase !== 'armed' && this.state.phase !== 'hearing') {
      return;
    }
    // The browser ended the session on its own: restart while voice activity
    // is still present, otherwise wait for the next speech burst.
    if (this.vadActive) {
      this.wantDetector = true;
      this.startDetector();
    } else {
      this.wantDetector = false;
    }
  }

  private trigger(phrase: string, confidence: number): void {
    if (this.state.phase !== 'armed' && this.state.phase !== 'hearing') {
      return;
    }
    this.teardown();
    const cooldownMs = this.deps.cooldownMs ?? DEFAULT_WAKE_COOLDOWN_MS;
    this.cooldownUntil = this.now() + cooldownMs;
    this.set({
      phase: 'triggered',
      level: 0,
      lastPhrase: phrase,
      lastConfidence: confidence,
      lastTriggerId: this.state.lastTriggerId + 1,
    });
    const settings = this.deps.settings();
    if (settings.wakeWordFeedback) {
      this.deps.chime?.();
    }
    this.deps.onWake?.(phrase, confidence);
    this.scheduleRearm();
  }

  private scheduleRearm(): void {
    if (this.rearmTimer) {
      clearTimeout(this.rearmTimer);
    }
    const cooldownMs = this.deps.cooldownMs ?? DEFAULT_WAKE_COOLDOWN_MS;
    this.rearmTimer = setTimeout(() => {
      this.rearmTimer = null;
      if (!this.paused && this.state.enabled && this.detectorSupported()) {
        void this.arm();
      }
    }, cooldownMs);
  }

  private teardown(): void {
    if (this.graceTimer) {
      clearTimeout(this.graceTimer);
      this.graceTimer = null;
    }
    if (this.rearmTimer) {
      clearTimeout(this.rearmTimer);
      this.rearmTimer = null;
    }
    this.stopDetector();
    this.stopLevel?.();
    this.stopLevel = null;
    this.vad?.reset();
    this.vad = null;
    this.vadActive = false;
    this.wantDetector = false;
    this.arming = false;
    this.detector = null;
    this.detectorOptions = null;
    this.deps.mic.release();
    this.stream = null;
  }
}

let wakeInstance: WakeWordEngine | null = null;
let chimeContext: ChimeContext | null = null;

function defaultChime(): void {
  if (typeof window === 'undefined') {
    return;
  }
  const w = window as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  const Ctor = w.AudioContext ?? w.webkitAudioContext;
  if (!Ctor) {
    return;
  }
  if (!chimeContext) {
    chimeContext = new Ctor() as unknown as ChimeContext;
  }
  playWakeChime(chimeContext);
}

/** Lazily-created shared engine wired to the real browser + settings store. */
export function getWakeWordEngine(): WakeWordEngine {
  if (!wakeInstance) {
    wakeInstance = new WakeWordEngine({
      mic: createMicManager(),
      detectorFactory: createWakeDetector,
      vadFactory: createVad,
      settings: () => currentVoiceSettings(),
      chime: defaultChime,
    });
  }
  return wakeInstance;
}

export { wakeThreshold };

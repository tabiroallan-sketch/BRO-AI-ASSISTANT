/**
 * Listening engine (Stage 5): coordinates the microphone, VAD, and speech
 * recognition into a small state machine with two input paths:
 *
 * - manual — explicit start (mic button / mic-toggle shortcut); VAD silence
 *   finalizes the utterance and returns to idle.
 * - ptt — starts on push-to-talk down, finalizes (and is consumed for
 *   auto-send) on VAD silence or push-to-talk up.
 *
 * All browser APIs are injected through `EngineDeps`, and the clock is
 * injectable, so the whole engine is unit-testable.
 */

import { createVad, type Vad, type VadOptions } from './vad';
import { createMicManager, type MicConstraints, type MicManager } from './mic';
import { currentVoiceSettings, saveVoiceSettings } from './settings';
import {
  createSpeechRecognizer,
  isSpeechRecognitionSupported,
  type SpeechRecognizer,
  type SpeechRecognizerOptions,
} from '@/lib/speech';
import type { ListeningMode, VoiceSettings } from '@/lib/desktop';

export type EnginePhase = 'idle' | 'requesting' | 'listening' | 'processing';
export type TranscriptSource = 'manual' | 'ptt';

export type EngineState = {
  phase: EnginePhase;
  mode: ListeningMode;
  /** Live mic level 0..1 (drives the orb / meter). */
  level: number;
  /** Live interim transcription. */
  interim: string;
  /** Last finalized transcript, consumed via consumeTranscript(). */
  transcript: string;
  transcriptId: number;
  transcriptSource: TranscriptSource | null;
  micSupported: boolean;
  sttSupported: boolean;
  error: string | null;
};

export type EngineDeps = {
  mic: MicManager;
  sttSupported: () => boolean;
  sttFactory: (options: SpeechRecognizerOptions) => SpeechRecognizer | null;
  vadFactory: (options: VadOptions) => Vad;
  settings: () => VoiceSettings;
  /** Level sample interval (ms). */
  sampleIntervalMs?: number;
  now?: () => number;
};

export function createEngineState(deps: EngineDeps): EngineState {
  return {
    phase: 'idle',
    mode: deps.settings().listeningMode,
    level: 0,
    interim: '',
    transcript: '',
    transcriptId: 0,
    transcriptSource: null,
    micSupported: deps.mic.supported(),
    sttSupported: deps.sttSupported(),
    error: null,
  };
}

export class VoiceEngine {
  private state: EngineState;
  private readonly listeners = new Set<(state: EngineState) => void>();
  private stream: MediaStream | null = null;
  private recognizer: SpeechRecognizer | null = null;
  private vad: Vad | null = null;
  private stopLevel: (() => void) | null = null;
  private captureSource: TranscriptSource | null = null;
  private finalText = '';

  constructor(private readonly deps: EngineDeps) {
    this.state = createEngineState(deps);
  }

  getState(): EngineState {
    return this.state;
  }

  private set(patch: Partial<EngineState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  subscribe(listener: (state: EngineState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  isListening(): boolean {
    return this.state.phase === 'listening' || this.state.phase === 'requesting';
  }

  setMode(mode: ListeningMode): void {
    if (mode === this.state.mode) {
      return;
    }
    this.set({ mode });
    void saveVoiceSettings({ listeningMode: mode });
  }

  /** Applies externally-loaded settings (e.g. desktop config) in place. */
  applySettings(settings: VoiceSettings): void {
    if (settings.listeningMode !== this.state.mode) {
      this.set({ mode: settings.listeningMode });
    }
  }

  async startManual(): Promise<void> {
    if (this.isListening()) {
      return;
    }
    await this.beginCapture('manual');
  }

  stop(): void {
    this.endCapture(true);
  }

  /** Ctrl+Shift+M shortcut (no-op when voice input is off). */
  onMicToggle(): void {
    if (this.state.mode === 'off') {
      return;
    }
    if (this.isListening()) {
      this.stop();
    } else {
      void this.startManual();
    }
  }

  onPushToTalkStart(): Promise<void> {
    if (this.state.mode !== 'ptt') {
      return Promise.resolve();
    }
    return this.beginCapture('ptt');
  }

  onPushToTalkStop(): void {
    if (this.captureSource !== 'ptt' || !this.isListening()) {
      return;
    }
    this.endCapture(true);
  }

  /** Consumes and clears the latest finalized transcript. */
  consumeTranscript(): { text: string; source: TranscriptSource } | null {
    if (!this.state.transcript) {
      return null;
    }
    const consumed = {
      text: this.state.transcript,
      source: this.state.transcriptSource ?? ('manual' as TranscriptSource),
    };
    this.set({ transcript: '', transcriptSource: null });
    return consumed;
  }

  private async beginCapture(source: TranscriptSource): Promise<void> {
    if (this.isListening()) {
      return;
    }
    this.captureSource = source;
    this.finalText = '';
    this.set({
      phase: 'requesting',
      level: 0,
      interim: '',
      transcript: '',
      transcriptId: 0,
      transcriptSource: null,
      error: null,
    });

    try {
      const settings = this.deps.settings();
      const constraints: MicConstraints = {
        deviceId: settings.inputDeviceId,
        echoCancellation: settings.echoCancellation,
        noiseSuppression: settings.noiseSuppression,
        autoGainControl: settings.autoGainControl,
      };
      const stream = await this.deps.mic.acquire(constraints);
      if (this.captureSource !== source) {
        this.deps.mic.release();
        return;
      }
      this.stream = stream;

      this.vad = this.deps.vadFactory({
        onSpeechStart: () => {
          // Orb/meter react to the level itself; nothing extra to do yet.
        },
        onSpeechEnd: () => {
          if (this.captureSource === source && this.isListening()) {
            this.endCapture(true);
          }
        },
        now: this.deps.now ?? (() => Date.now()),
      });

      this.stopLevel = this.deps.mic.levelMeter(
        stream,
        (level) => {
          this.vad?.feed(level);
          this.set({ level });
        },
        this.deps.sampleIntervalMs,
      );

      const recognizer = this.deps.sttFactory({
        onInterim: (text) => this.set({ interim: text }),
        onFinal: (text) => {
          this.finalText = text;
          this.set({ interim: '' });
        },
        onEnd: () => {
          if (this.isListening()) {
            this.endCapture(true);
          }
        },
        onError: (message) => this.fail(message),
      });
      if (!recognizer) {
        this.cleanup();
        this.captureSource = null;
        this.set({ phase: 'idle', error: 'Speech recognition is not available in this app.' });
        return;
      }
      this.recognizer = recognizer;
      recognizer.start();
      this.set({ phase: 'listening' });
    } catch (error) {
      this.fail(error instanceof Error ? error.message : 'Could not access the microphone.');
    }
  }

  private emitTranscript(source: TranscriptSource): void {
    const text = (this.finalText || this.state.interim).trim();
    if (!text) {
      return;
    }
    this.finalText = '';
    this.set({
      transcript: text,
      transcriptId: this.state.transcriptId + 1,
      transcriptSource: source,
      interim: '',
    });
  }

  private cleanup(): void {
    this.stopLevel?.();
    this.stopLevel = null;
    this.vad?.reset();
    this.vad = null;
    this.recognizer = null;
    this.deps.mic.release();
    this.stream = null;
  }

  private endCapture(finalize: boolean): void {
    if (this.state.phase === 'idle') {
      return;
    }
    const source = this.captureSource;
    this.recognizer?.stop();
    this.cleanup();
    this.captureSource = null;
    if (finalize && source) {
      this.emitTranscript(source);
    }
    this.set({ phase: 'idle', level: 0, interim: '' });
  }

  private fail(message: string): void {
    this.recognizer?.stop();
    this.cleanup();
    this.captureSource = null;
    this.set({ phase: 'idle', level: 0, interim: '', error: message });
  }
}

let instance: VoiceEngine | null = null;

/** Lazily-created shared engine wired to the real browser + settings store. */
export function getVoiceEngine(): VoiceEngine {
  if (!instance) {
    instance = new VoiceEngine({
      mic: createMicManager(),
      sttSupported: () => isSpeechRecognitionSupported(),
      sttFactory: createSpeechRecognizer,
      vadFactory: createVad,
      settings: () => currentVoiceSettings(),
    });
  }
  return instance;
}

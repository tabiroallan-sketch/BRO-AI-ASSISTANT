import { useAiState } from './ai-state';
import { audioLevel } from './audio-level';

export type MicMode = 'off' | 'demo' | 'live';

type WebkitWindow = {
  webkitAudioContext?: typeof AudioContext;
};

/**
 * Microphone + analyser engine that feeds `audioLevel` every animation frame.
 * Runs in `demo` mode by default (procedural signal that reacts to the AI
 * state) so the scene is always visibly reactive; upgrades to `live` mode on
 * the first user gesture if microphone permission is granted.
 */
class AudioEngine {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private data: Uint8Array<ArrayBuffer> | null = null;
  private raf = 0;
  private last = 0;
  private mode: MicMode = 'off';

  getMicMode(): MicMode {
    return this.mode;
  }

  /** Begin rendering audio levels without touching the microphone. */
  startDemo(): void {
    if (this.mode !== 'off') {
      return;
    }
    this.mode = 'demo';
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  /** Attempt to open the microphone; falls back to demo mode on denial. */
  requestLive(): void {
    if (this.mode === 'off') {
      this.startDemo();
    }
    if (this.mode === 'live' || typeof navigator === 'undefined' || !navigator.mediaDevices) {
      return;
    }
    void this.tryLive();
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.stream?.getTracks().forEach((track) => track.stop());
    void this.ctx?.close();
    this.stream = null;
    this.ctx = null;
    this.source = null;
    this.analyser = null;
    this.data = null;
    this.mode = 'off';
    audioLevel.level = 0;
    audioLevel.smoothed = 0;
  }

  private async tryLive(): Promise<void> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      if (this.mode === 'live' || this.mode === 'off') {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const windowRef = window as unknown as WebkitWindow;
      const Ctor = window.AudioContext ?? windowRef.webkitAudioContext;
      const ctx = new Ctor();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.8;
      const source = ctx.createMediaStreamSource(stream);
      source.connect(analyser);
      await ctx.resume();
      this.ctx = ctx;
      this.analyser = analyser;
      this.source = source;
      this.stream = stream;
      this.data = new Uint8Array(analyser.frequencyBinCount);
      this.mode = 'live';
    } catch {
      this.mode = 'demo';
    }
  }

  private loop = (): void => {
    const now = performance.now();
    const dt = Math.min((now - this.last) / 1000, 0.1);
    this.last = now;

    if (this.mode === 'live' && this.analyser && this.data) {
      this.analyser.getByteFrequencyData(this.data);
      const bins = Math.min(64, this.data.length);
      let sum = 0;
      for (let i = 0; i < bins; i += 1) {
        sum += this.data[i];
      }
      const rms = sum / bins / 255;
      const level = Math.min(1, Math.pow(rms, 1.6) * 2.4);
      audioLevel.level = level;
      audioLevel.smoothed += (level - audioLevel.smoothed) * Math.min(1, dt * 18);
    } else if (this.mode === 'demo') {
      const level = this.demoLevel(now / 1000);
      audioLevel.level = level;
      audioLevel.smoothed += (level - audioLevel.smoothed) * Math.min(1, dt * 10);
    }

    this.raf = requestAnimationFrame(this.loop);
  };

  private demoLevel(t: number): number {
    const state = useAiState.getState().state;
    const wave = Math.sin(t * 1.7) * 0.5 + Math.sin(t * 3.1 + 1.3) * 0.3 + Math.sin(t * 0.6) * 0.2;
    const agitation = wave * 0.5 + 0.5;

    let amp = 0.35;
    if (state === 'thinking' || state === 'executing') {
      amp = 0.65;
    } else if (state === 'speaking' || state === 'listening') {
      amp = 0.55;
    } else if (state === 'success') {
      amp = 0.45;
    } else if (state === 'warning' || state === 'error') {
      amp = 0.5;
    }

    const burst = Math.pow(Math.max(0, Math.sin(t * 7.3) * Math.sin(t * 2.9)), 3) * 0.4;
    return Math.min(1, 0.12 + agitation * amp + burst);
  }
}

export const audioEngine = new AudioEngine();

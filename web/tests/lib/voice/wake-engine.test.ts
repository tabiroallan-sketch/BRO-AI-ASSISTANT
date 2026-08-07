import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  WakeWordEngine,
  DEFAULT_WAKE_COOLDOWN_MS,
  DEFAULT_WAKE_GRACE_MS,
} from '@/lib/voice/wake-engine';
import { createVad } from '@/lib/voice/vad';
import { DEFAULT_VOICE_SETTINGS, type VoiceSettings } from '@/lib/desktop';

function baseSettings(overrides: Partial<VoiceSettings> = {}): VoiceSettings {
  return {
    ...DEFAULT_VOICE_SETTINGS,
    wakeWordEnabled: true,
    wakeWordSensitivity: 0.6,
    wakeWordPhrases: ['hey bro', 'bro', 'wake up'],
    wakeWordFeedback: true,
    ...overrides,
  };
}

type EngineHarness = {
  engine: WakeWordEngine;
  pump: (level: number) => void;
  detector: {
    started: () => number;
    stopped: () => number;
    running: () => boolean;
    trigger: (phrase: string, confidence: number) => void;
  };
  micAcquires: () => number;
  micReleases: () => number;
  onWake: ReturnType<typeof vi.fn>;
  chime: ReturnType<typeof vi.fn>;
};

function harness(settings: VoiceSettings, overrides: Record<string, unknown> = {}): EngineHarness {
  const onWake = vi.fn();
  const chime = vi.fn();
  let currentSettings = settings;
  let acquired = 0;
  let released = 0;
  let onLevel: ((level: number) => void) | null = null;
  let lastDetector: {
    started: number;
    stopped: number;
    running: boolean;
    start: () => void;
    stop: () => void;
    isRunning: () => boolean;
    onDetected: ((d: { phrase: string; confidence: number }) => void) | null;
  } | null = null;

  const mic = {
    supported: () => true,
    listDevices: async () => ({ inputs: [], outputs: [] }),
    acquire: async () => {
      acquired += 1;
      return {} as MediaStream;
    },
    release: () => {
      released += 1;
    },
    levelMeter: (_stream: MediaStream, cb: (level: number) => void) => {
      onLevel = cb;
      return () => {
        onLevel = null;
      };
    },
  };

  const detectorFactory = vi.fn(
    (options: {
      phrases: string[];
      sensitivity: number;
      onDetected: (d: { phrase: string; confidence: number }) => void;
      onEnd: () => void;
    }) => {
      lastDetector = {
        started: 0,
        stopped: 0,
        running: false,
        start() {
          this.started += 1;
          this.running = true;
        },
        stop() {
          this.stopped += 1;
          this.running = false;
        },
        isRunning: () => Boolean(lastDetector && lastDetector.running),
        onDetected: options.onDetected,
      };
      return lastDetector as never;
    },
  );

  const engine = new WakeWordEngine({
    mic: mic as never,
    detectorFactory: detectorFactory as never,
    vadFactory: createVad,
    settings: () => currentSettings,
    chime,
    onWake,
    now: () => Date.now(),
    cooldownMs: DEFAULT_WAKE_COOLDOWN_MS,
    graceMs: DEFAULT_WAKE_GRACE_MS,
    supported: () => (overrides.supported === undefined ? true : Boolean(overrides.supported)),
  });

  return {
    engine,
    pump: (level) => onLevel?.(level),
    detector: {
      started: () => lastDetector?.started ?? 0,
      stopped: () => lastDetector?.stopped ?? 0,
      running: () => Boolean(lastDetector?.running),
      trigger: (phrase, confidence) => lastDetector?.onDetected?.({ phrase, confidence }),
    },
    micAcquires: () => acquired,
    micReleases: () => released,
    onWake,
    chime,
  };
}

async function flush(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

describe('WakeWordEngine', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts disabled when the wake word is not enabled', () => {
    const { engine } = harness(baseSettings({ wakeWordEnabled: false }));
    expect(engine.getState().phase).toBe('disabled');
    expect(engine.getState().enabled).toBe(false);
  });

  it('errors when speech recognition is unavailable', () => {
    const { engine } = harness(baseSettings(), { supported: false });
    expect(engine.getState().phase).toBe('error');
    expect(engine.getState().error).toContain('speech recognition');
  });

  it('arms and acquires the microphone when enabled', async () => {
    const { engine, micAcquires } = harness(baseSettings());
    expect(engine.getState().phase).toBe('disabled');
    engine.applySettings(baseSettings());
    await flush();
    expect(engine.getState().phase).toBe('armed');
    expect(micAcquires()).toBe(1);
    expect(engine.getState().level).toBe(0);
  });

  it('energy-gates the recognizer: starts on speech, stops after silence', async () => {
    const { engine, pump, detector } = harness(baseSettings());
    engine.applySettings(baseSettings());
    await flush();
    expect(detector.started()).toBe(0);

    pump(0.5);
    await vi.advanceTimersByTimeAsync(100);
    pump(0.5);
    await vi.advanceTimersByTimeAsync(100);
    pump(0.5);
    await vi.advanceTimersByTimeAsync(100);
    expect(engine.getState().phase).toBe('hearing');
    expect(detector.started()).toBe(1);
    expect(detector.running()).toBe(true);

    for (let i = 0; i < 10; i += 1) {
      pump(0);
      await vi.advanceTimersByTimeAsync(100);
    }
    expect(engine.getState().phase).toBe('armed');
    await vi.advanceTimersByTimeAsync(DEFAULT_WAKE_GRACE_MS + 10);
    expect(detector.running()).toBe(false);
    expect(detector.stopped()).toBe(1);
  });

  it('triggers onWake and chime once when the detector fires', async () => {
    const { engine, detector, onWake, chime } = harness(baseSettings());
    engine.applySettings(baseSettings());
    await flush();

    detector.trigger('hey bro', 0.8);
    await flush();

    expect(engine.getState().phase).toBe('triggered');
    expect(engine.getState().lastPhrase).toBe('hey bro');
    expect(engine.getState().lastConfidence).toBe(0.8);
    expect(engine.getState().lastTriggerId).toBe(1);
    expect(onWake).toHaveBeenCalledWith('hey bro', 0.8);
    expect(chime).toHaveBeenCalledTimes(1);
  });

  it('does not chime when feedback is disabled', async () => {
    const { engine, detector, chime } = harness(baseSettings({ wakeWordFeedback: false }));
    engine.applySettings(baseSettings({ wakeWordFeedback: false }));
    await flush();
    detector.trigger('bro', 0.9);
    await flush();
    expect(chime).not.toHaveBeenCalled();
  });

  it('re-arms after the cooldown elapses', async () => {
    const { engine, detector, micAcquires } = harness(baseSettings());
    engine.applySettings(baseSettings());
    await flush();

    detector.trigger('bro', 0.9);
    await flush();
    expect(engine.getState().phase).toBe('triggered');
    expect(micAcquires()).toBe(1);

    await vi.advanceTimersByTimeAsync(DEFAULT_WAKE_COOLDOWN_MS - 1);
    expect(engine.getState().phase).toBe('triggered');

    await vi.advanceTimersByTimeAsync(2);
    expect(engine.getState().phase).toBe('armed');
    expect(micAcquires()).toBe(2);
  });

  it('pause releases the mic and stops the detector', async () => {
    const { engine, pump, detector, micReleases } = harness(baseSettings());
    engine.applySettings(baseSettings());
    await flush();
    pump(0.5);
    await vi.advanceTimersByTimeAsync(100);
    pump(0.5);
    await vi.advanceTimersByTimeAsync(100);
    pump(0.5);
    await vi.advanceTimersByTimeAsync(100);
    expect(detector.running()).toBe(true);

    engine.pause();
    expect(engine.getState().phase).toBe('paused');
    expect(detector.running()).toBe(false);
    expect(micReleases()).toBe(1);

    engine.resume();
    await flush();
    expect(engine.getState().phase).toBe('armed');
  });

  it('disable tears everything down', async () => {
    const { engine, pump, detector, micReleases } = harness(baseSettings());
    engine.applySettings(baseSettings());
    await flush();
    pump(0.5);
    await vi.advanceTimersByTimeAsync(100);
    pump(0.5);
    await vi.advanceTimersByTimeAsync(100);
    pump(0.5);
    await vi.advanceTimersByTimeAsync(100);
    expect(detector.running()).toBe(true);

    engine.applySettings(baseSettings({ wakeWordEnabled: false }));
    await flush();
    expect(engine.getState().phase).toBe('disabled');
    expect(detector.running()).toBe(false);
    expect(micReleases()).toBe(1);
  });

  it('ignores a trigger while not armed', async () => {
    const { engine, detector, onWake } = harness(baseSettings());
    detector.trigger('bro', 0.9);
    await flush();
    expect(onWake).not.toHaveBeenCalled();
  });

  it('updates phrases and sensitivity for the next arm', async () => {
    const { engine, pump, detector } = harness(baseSettings());
    engine.applySettings(baseSettings());
    await flush();
    engine.applySettings(baseSettings({ wakeWordPhrases: ['computer'] }));
    await flush();
    pump(0.5);
    pump(0.5);
    pump(0.5);
    await flush();
    expect(engine.getState().phase).toBe('hearing');
  });
});

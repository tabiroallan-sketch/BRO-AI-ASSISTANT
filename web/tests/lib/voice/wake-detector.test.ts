import { describe, expect, it, vi } from 'vitest';
import type { SpeechRecognizer, SpeechRecognizerOptions } from '@/lib/speech';
import {
  WAKE_FULL_MATCH_BASE,
  WAKE_STABILITY_STEP,
  createWakeDetector,
  findWakeMatch,
  normalizeWakeText,
  wakeConfidence,
  wakeThreshold,
} from '@/lib/voice/wake-detector';
import { DEFAULT_VOICE_SETTINGS } from '@/lib/desktop';

describe('normalizeWakeText', () => {
  it('lowercases and collapses whitespace', () => {
    expect(normalizeWakeText('  Hey   BRO,  wake  up  ')).toBe('hey bro, wake up');
  });

  it('handles empty input', () => {
    expect(normalizeWakeText('')).toBe('');
  });
});

describe('findWakeMatch', () => {
  const phrases = ['hey bro', 'bro', 'wake up'];

  it('matches a full phrase', () => {
    const match = findWakeMatch('hey bro can you help', phrases);
    expect(match).toMatchObject({ phrase: 'hey bro', coverage: 1 });
  });

  it('is case and spacing insensitive', () => {
    expect(findWakeMatch('HEY   BRO', phrases)?.phrase).toBe('hey bro');
  });

  it('requires word boundaries for short words', () => {
    expect(findWakeMatch('broccoli is green', phrases)).toBeNull();
    expect(findWakeMatch('a brother went', phrases)).toBeNull();
    expect(findWakeMatch('hey brother', phrases)).toBeNull();
    expect(findWakeMatch('bro!', phrases)?.phrase).toBe('bro');
  });

  it('matches standalone bro', () => {
    expect(findWakeMatch('bro, check this', phrases)?.phrase).toBe('bro');
  });

  it('matches multi-word phrase contiguously', () => {
    expect(findWakeMatch('please wake up now', phrases)?.phrase).toBe('wake up');
    expect(findWakeMatch('wake up hill', phrases)?.phrase).toBe('wake up');
    expect(findWakeMatch('wake upper hand', phrases)).toBeNull();
  });

  it('returns null when no phrase matches', () => {
    expect(findWakeMatch('how are you doing', phrases)).toBeNull();
  });

  it('returns null on empty text', () => {
    expect(findWakeMatch('   ', phrases)).toBeNull();
  });
});

describe('wakeConfidence', () => {
  const full = { phrase: 'hey bro', index: 0, coverage: 1 };

  it('full match ramps with stability', () => {
    expect(wakeConfidence(full, 1)).toBe(WAKE_FULL_MATCH_BASE);
    expect(wakeConfidence(full, 2)).toBe(WAKE_FULL_MATCH_BASE + WAKE_STABILITY_STEP);
    expect(wakeConfidence(full, 3)).toBe(WAKE_FULL_MATCH_BASE + 2 * WAKE_STABILITY_STEP);
  });

  it('never exceeds 1', () => {
    expect(wakeConfidence(full, 99)).toBe(1);
  });

  it('scales partial matches by coverage', () => {
    const partial = { phrase: 'hey bro', index: 0, coverage: 0.5 };
    expect(wakeConfidence(partial, 1)).toBeCloseTo(0.5 * 0.6, 6);
  });
});

describe('wakeThreshold', () => {
  it('maps sensitivity to a stricter threshold', () => {
    const low = wakeThreshold(0.2);
    const high = wakeThreshold(1);
    expect(low).toBeGreaterThan(high);
  });

  it('default sensitivity is balanced', () => {
    const threshold = wakeThreshold(DEFAULT_VOICE_SETTINGS.wakeWordSensitivity);
    expect(threshold).toBeGreaterThan(WAKE_FULL_MATCH_BASE);
    expect(threshold).toBeLessThanOrEqual(WAKE_FULL_MATCH_BASE + WAKE_STABILITY_STEP);
  });
});

function fakeRecognizer(): {
  recognizer: SpeechRecognizer;
  factory: (
    stream: MediaStream,
    options: SpeechRecognizerOptions,
    maxDurationMs: number,
  ) => SpeechRecognizer | null;
  options: () => SpeechRecognizerOptions | null;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
} {
  let captured: SpeechRecognizerOptions | null = null;
  const start = vi.fn();
  const stop = vi.fn();
  const recognizer: SpeechRecognizer = { start, stop, isListening: () => false };
  const factory = (
    _stream: MediaStream,
    options: SpeechRecognizerOptions,
    _maxDurationMs: number,
  ): SpeechRecognizer | null => {
    captured = options;
    return recognizer;
  };
  return { recognizer, factory, options: () => captured, start, stop };
}

const wakeOptions = (overrides: Partial<{ sensitivity: number }> = {}) => ({
  phrases: ['hey bro'],
  sensitivity: overrides.sensitivity ?? 0.6,
  onDetected: vi.fn(),
  onEnd: vi.fn(),
});

describe('createWakeDetector', () => {
  it('returns null when transcription is unavailable', () => {
    const detector = createWakeDetector({} as MediaStream, wakeOptions(), () => null);
    expect(detector).toBeNull();
  });

  it('starts the recognizer when started and is idempotent', () => {
    const fake = fakeRecognizer();
    const detector = createWakeDetector({} as MediaStream, wakeOptions(), fake.factory)!;
    detector.start();
    expect(fake.start).toHaveBeenCalledTimes(1);
    expect(detector.isRunning()).toBe(true);
    detector.start();
    expect(fake.start).toHaveBeenCalledTimes(1);
  });

  it('fires onDetected when a final transcript contains the phrase', () => {
    const onDetected = vi.fn();
    const onEnd = vi.fn();
    const fake = fakeRecognizer();
    const detector = createWakeDetector(
      {} as MediaStream,
      { ...wakeOptions(), onDetected, onEnd },
      fake.factory,
    )!;
    detector.start();
    fake.options()?.onFinal?.('hey bro wake up');
    expect(onDetected).toHaveBeenCalledWith({
      phrase: 'hey bro',
      confidence: expect.any(Number),
    });
    expect(onEnd).not.toHaveBeenCalled();
    expect(detector.isRunning()).toBe(true);
  });

  it('does not fire for transcripts without the phrase', () => {
    const onDetected = vi.fn();
    const fake = fakeRecognizer();
    const detector = createWakeDetector(
      {} as MediaStream,
      { ...wakeOptions(), onDetected },
      fake.factory,
    )!;
    detector.start();
    fake.options()?.onFinal?.('how are you doing');
    fake.options()?.onInterim?.('hey');
    expect(onDetected).not.toHaveBeenCalled();
  });

  it('respects word boundaries for short phrases', () => {
    const onDetected = vi.fn();
    const fake = fakeRecognizer();
    const detector = createWakeDetector(
      {} as MediaStream,
      { phrases: ['bro'], sensitivity: 0.2, onDetected, onEnd: vi.fn() },
      fake.factory,
    )!;
    detector.start();
    fake.options()?.onFinal?.('broccoli is green');
    expect(onDetected).not.toHaveBeenCalled();
  });

  it('reports recognizer ends and errors through onEnd', () => {
    const onEnd = vi.fn();
    const fake = fakeRecognizer();
    const detector = createWakeDetector(
      {} as MediaStream,
      { ...wakeOptions(), onEnd },
      fake.factory,
    )!;
    detector.start();
    fake.options()?.onEnd?.();
    expect(onEnd).toHaveBeenCalled();
  });

  it('stops the recognizer when stopped', () => {
    const fake = fakeRecognizer();
    const detector = createWakeDetector({} as MediaStream, wakeOptions(), fake.factory)!;
    detector.start();
    detector.stop();
    expect(fake.stop).toHaveBeenCalledTimes(1);
    expect(detector.isRunning()).toBe(false);
  });
});

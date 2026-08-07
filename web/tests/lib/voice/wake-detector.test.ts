import { describe, expect, it, vi } from 'vitest';
import type { RecognitionConstructor, RecognitionLike } from '@/lib/speech';
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
  Ctor: RecognitionConstructor;
  instance: () => RecognitionLike | null;
  emit: (text: string) => void;
  emitFinal: (text: string) => void;
} {
  let current: RecognitionLike | null = null;
  const emit = (text: string, isFinal = false): void => {
    current?.onresult?.({
      results: [{ isFinal, 0: { transcript: text } }],
    });
  };
  const Ctor = class {
    continuous = false;
    interimResults = false;
    lang = '';
    onresult: RecognitionLike['onresult'] = null;
    onend: RecognitionLike['onend'] = null;
    onerror: RecognitionLike['onerror'] = null;
    start = vi.fn(() => {
      current = this as unknown as RecognitionLike;
    });
    stop = vi.fn(() => {
      current = null;
      this.onend?.();
    });
  } as unknown as RecognitionConstructor;
  return {
    Ctor,
    instance: () => current,
    emit: (text) => emit(text),
    emitFinal: (text) => emit(text, true),
  };
}

describe('createWakeDetector', () => {
  it('returns null without a recognition constructor', () => {
    const detector = createWakeDetector(
      { phrases: ['hey bro'], sensitivity: 0.6, onDetected: vi.fn(), onEnd: vi.fn() },
      null,
    );
    expect(detector).toBeNull();
  });

  it('starts a continuous recognizer with interim results', () => {
    const { Ctor, instance } = fakeRecognizer();
    const detector = createWakeDetector(
      { phrases: ['hey bro'], sensitivity: 0.6, onDetected: vi.fn(), onEnd: vi.fn() },
      Ctor,
    )!;
    detector.start();
    expect(detector.isRunning()).toBe(true);
    expect(instance()?.continuous).toBe(true);
    expect(instance()?.interimResults).toBe(true);
  });

  it('fires onDetected with the phrase and confidence', () => {
    const onDetected = vi.fn();
    const onEnd = vi.fn();
    const { Ctor, emit, emitFinal } = fakeRecognizer();
    const detector = createWakeDetector(
      { phrases: ['hey bro'], sensitivity: 0.6, onDetected, onEnd },
      Ctor,
    )!;
    detector.start();
    emitFinal('hey bro');
    emit('hey bro');
    expect(onDetected).toHaveBeenCalledWith({
      phrase: 'hey bro',
      confidence: expect.any(Number),
    });
    expect(onEnd).not.toHaveBeenCalled();
    expect(detector.isRunning()).toBe(false);
  });

  it('does not fire below the sensitivity threshold', () => {
    const onDetected = vi.fn();
    const { Ctor, emit } = fakeRecognizer();
    const detector = createWakeDetector(
      { phrases: ['hey bro'], sensitivity: 1, onDetected, onEnd: vi.fn() },
      Ctor,
    )!;
    detector.start();
    emit('hey b');
    expect(onDetected).not.toHaveBeenCalled();
  });

  it('ignores word-boundary false positives like "broccoli"', () => {
    const onDetected = vi.fn();
    const { Ctor, emit } = fakeRecognizer();
    const detector = createWakeDetector(
      { phrases: ['bro'], sensitivity: 0.2, onDetected, onEnd: vi.fn() },
      Ctor,
    )!;
    detector.start();
    emit('broccoli');
    expect(onDetected).not.toHaveBeenCalled();
  });

  it('reports browser-initiated ends through onEnd', () => {
    const onEnd = vi.fn();
    const { Ctor, instance } = fakeRecognizer();
    const detector = createWakeDetector(
      { phrases: ['hey bro'], sensitivity: 0.6, onDetected: vi.fn(), onEnd },
      Ctor,
    )!;
    detector.start();
    instance()?.onend?.();
    expect(onEnd).toHaveBeenCalled();
  });
});

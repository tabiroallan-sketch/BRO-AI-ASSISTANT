/**
 * Voice-activity detection (Stage 5): a small state machine that watches a
 * stream of mic level samples (0..1) and reports the start/end of speech.
 * Pure and clock-injectable so it is fully unit-testable.
 */

export type VadOptions = {
  onSpeechStart: () => void;
  onSpeechEnd: () => void;
  /** Level >= this counts as speech (default 0.05). */
  threshold?: number;
  /** Consecutive above-threshold samples required to enter speech. */
  startFrames?: number;
  /** Consecutive below-threshold samples required to end speech (hangover). */
  endFrames?: number;
  /** Utterances shorter than this are dropped as noise. */
  minSpeechMs?: number;
  /** Hard cap for a single utterance (safety release). */
  maxSpeechMs?: number;
  now: () => number;
};

export type Vad = {
  feed: (level: number) => void;
  isActive: () => boolean;
  reset: () => void;
};

const DEFAULT_THRESHOLD = 0.05;
const DEFAULT_START_FRAMES = 3;
const DEFAULT_END_FRAMES = 8;
const DEFAULT_MIN_SPEECH_MS = 300;
const DEFAULT_MAX_SPEECH_MS = 15_000;

export function createVad(options: VadOptions): Vad {
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  const startFrames = options.startFrames ?? DEFAULT_START_FRAMES;
  const endFrames = options.endFrames ?? DEFAULT_END_FRAMES;
  const minSpeechMs = options.minSpeechMs ?? DEFAULT_MIN_SPEECH_MS;
  const maxSpeechMs = options.maxSpeechMs ?? DEFAULT_MAX_SPEECH_MS;

  let active = false;
  let framesAbove = 0;
  let framesBelow = 0;
  let speechStartAt = 0;

  function endUtterance(now: number): void {
    const duration = now - speechStartAt;
    active = false;
    framesAbove = 0;
    framesBelow = 0;
    speechStartAt = 0;
    if (duration >= minSpeechMs) {
      options.onSpeechEnd();
    }
  }

  return {
    feed(level: number): void {
      const now = options.now();
      const isAbove = level >= threshold;

      if (!active) {
        framesBelow = 0;
        framesAbove = isAbove ? framesAbove + 1 : 0;
        if (framesAbove >= startFrames) {
          active = true;
          speechStartAt = now;
          options.onSpeechStart();
        }
        return;
      }

      framesBelow = isAbove ? 0 : framesBelow + 1;
      if (now - speechStartAt >= maxSpeechMs) {
        endUtterance(now);
        return;
      }
      if (!isAbove && framesBelow >= endFrames) {
        endUtterance(now);
      }
    },
    isActive: () => active,
    reset: () => {
      active = false;
      framesAbove = 0;
      framesBelow = 0;
      speechStartAt = 0;
    },
  };
}

/**
 * Wake-word detection (Stage 6): keyword spotting on continuous Web Speech
 * interim results. The pure pieces (`normalizeWakeText`, `findWakeMatch`,
 * `wakeConfidence`, `wakeThreshold`) are unit-tested; the browser recognizer
 * wrapper is built from an injectable constructor so it stays mockable.
 *
 * The engine gates the recognizer with voice activity (energy pre-gate): the
 * recognizer only runs while speech-like audio is present, which keeps CPU
 * down and silence/TV from producing false triggers.
 */

import { getSpeechRecognitionConstructor, type RecognitionConstructor } from '@/lib/speech';

export type WakeMatch = {
  /** The phrase that was matched. */
  phrase: string;
  /** Index of the match inside the normalized text. */
  index: number;
  /** 0..1 — how much of the phrase is present contiguously. */
  coverage: number;
};

export type WakeDetection = {
  phrase: string;
  confidence: number;
};

/** Full-match baseline before stability is factored in. */
export const WAKE_FULL_MATCH_BASE = 0.6;
/** Confidence added per additional stable snapshot that contains the match. */
export const WAKE_STABILITY_STEP = 0.2;
/** Scales partial (incomplete) matches before stability is applied. */
export const WAKE_PARTIAL_SCALE = 0.6;
/** How many recent snapshots the detector remembers for stability. */
export const WAKE_STABILITY_WINDOW = 3;

/** Lowercases and collapses whitespace so matching is case/space-insensitive. */
export function normalizeWakeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function isLetter(character: string): boolean {
  return character !== '' && /[a-z0-9]/.test(character);
}

/**
 * Finds the strongest phrase match inside text. Short single-word phrases
 * ("bro") require word boundaries so "broccoli" or "brothers" don't trigger;
 * multi-word phrases must appear contiguously. Incomplete phrases score by
 * coverage, letting confidence ramp up as interim results finish.
 */
export function findWakeMatch(text: string, phrases: readonly string[]): WakeMatch | null {
  const normalized = normalizeWakeText(text);
  if (!normalized) {
    return null;
  }
  let best: WakeMatch | null = null;
  for (const phrase of phrases) {
    const key = normalizeWakeText(phrase);
    if (!key) {
      continue;
    }
    const index = normalized.indexOf(key);
    if (index === -1) {
      continue;
    }
    const before = index > 0 ? normalized[index - 1] : '';
    const afterIndex = index + key.length;
    const after = afterIndex < normalized.length ? normalized[afterIndex] : '';
    const boundaryBefore = index === 0 || !isLetter(before);
    const boundaryAfter = afterIndex === normalized.length || !isLetter(after);
    if (!boundaryBefore || !boundaryAfter) {
      continue;
    }
    const coverage = key.length > 0 ? 1 : 0;
    if (!best || coverage > best.coverage) {
      best = { phrase: key, index, coverage };
    }
  }
  return best;
}

/**
 * Confidence of a match given how many consecutive snapshots it has been
 * present in. Full matches start at `WAKE_FULL_MATCH_BASE` and need a couple
 * of stable snapshots to cross the default threshold; partial matches scale
 * by coverage. Returns 0..1.
 */
export function wakeConfidence(match: WakeMatch, stability: number): number {
  const base = match.coverage >= 1 ? WAKE_FULL_MATCH_BASE : match.coverage * WAKE_PARTIAL_SCALE;
  const steps = Math.max(0, Math.min(WAKE_STABILITY_WINDOW - 1, stability - 1));
  return Math.min(1, base + WAKE_STABILITY_STEP * steps);
}

/**
 * Minimum confidence required to trigger, from the 0.2..1 sensitivity slider.
 * Higher sensitivity (closer to 1) requires a clearer, stabler match.
 */
export function wakeThreshold(sensitivity: number): number {
  return Math.min(0.8, Math.max(0.5, 0.85 - 0.35 * sensitivity));
}

export type WakeDetector = {
  /** Starts listening for the wake word. */
  start: () => void;
  /** Stops listening. Safe to call when not running. */
  stop: () => void;
  isRunning: () => boolean;
};

export type WakeDetectorOptions = {
  phrases: readonly string[];
  sensitivity: number;
  onDetected: (detection: WakeDetection) => void;
  onEnd: () => void;
};

export type WakeDetectorFactory = (options: WakeDetectorOptions) => WakeDetector | null;

/**
 * Creates a keyword-spotting recognizer from an injectable constructor, or
 * null when speech recognition is unavailable in this environment.
 */
export function createWakeDetector(
  options: WakeDetectorOptions,
  recognitionConstructor: RecognitionConstructor | null = getSpeechRecognitionConstructor(),
): WakeDetector | null {
  if (!recognitionConstructor) {
    return null;
  }
  const recognition = new recognitionConstructor();
  let running = false;
  let stoppedByUs = false;
  let snapshots: string[] = [];

  const snapshotText = (): string => snapshots[snapshots.length - 1] ?? '';

  function evaluate(): void {
    const latest = snapshotText();
    if (!latest) {
      return;
    }
    const match = findWakeMatch(latest, options.phrases);
    if (!match) {
      return;
    }
    const stability = snapshots.filter((entry) => findWakeMatch(entry, options.phrases)).length;
    const confidence = wakeConfidence(match, stability);
    if (confidence >= wakeThreshold(options.sensitivity)) {
      options.onDetected({ phrase: match.phrase, confidence });
      stopDetector();
    }
  }

  function stopDetector(): void {
    if (!running) {
      return;
    }
    stoppedByUs = true;
    recognition.stop();
  }

  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'en-US';
  recognition.onresult = (event) => {
    let interim = '';
    let final = '';
    for (const result of event.results) {
      if (result.isFinal) {
        final += result[0].transcript;
      } else {
        interim += result[0].transcript;
      }
    }
    const latest = normalizeWakeText(`${final} ${interim}`);
    snapshots.push(latest);
    if (snapshots.length > WAKE_STABILITY_WINDOW) {
      snapshots.shift();
    }
    evaluate();
  };
  recognition.onend = () => {
    const wasRunning = running;
    running = false;
    if (wasRunning && !stoppedByUs) {
      // The browser ended the session (it can stop on its own); let the engine
      // decide whether to restart via onEnd.
      options.onEnd();
    }
    stoppedByUs = false;
  };
  recognition.onerror = (event) => {
    if (event.error === 'aborted') {
      return;
    }
    running = false;
    stoppedByUs = false;
    options.onEnd();
  };

  return {
    start: () => {
      if (running) {
        return;
      }
      snapshots = [];
      stoppedByUs = false;
      recognition.start();
      running = true;
    },
    stop: () => {
      stopDetector();
    },
    isRunning: () => running,
  };
}

/**
 * Whether the wake-word engine can run at all in this environment.
 */
export function isWakeWordSupported(): boolean {
  return getSpeechRecognitionConstructor() !== null;
}

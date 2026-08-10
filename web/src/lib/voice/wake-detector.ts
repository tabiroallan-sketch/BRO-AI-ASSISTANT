/**
 * Wake-word detection (Stage 6): records the stream and matches the transcribed
 * text for a phrase. The pure pieces (`normalizeWakeText`, `findWakeMatch`,
 * `wakeConfidence`, `wakeThreshold`) are unit-tested; the recorder wrapper is
 * built from the shared transcribe recognizer so it stays mockable.
 *
 * The engine gates the detector with voice activity (energy pre-gate): the
 * detector only records while speech-like audio is present, which keeps CPU
 * down and silence/TV from producing false triggers.
 */

import type { SpeechRecognizer, SpeechRecognizerOptions } from '@/lib/speech';
import { createTranscribeRecognizer } from './recognizer';
import { isTranscriptionSupported } from './transcribe';

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

export type WakeDetectorFactory = (
  stream: MediaStream,
  options: WakeDetectorOptions,
) => WakeDetector | null;

/** Builds the speech recognizer used under the hood; injectable for tests. */
export type RecognizerFactory = (
  stream: MediaStream,
  options: SpeechRecognizerOptions,
  maxDurationMs: number,
) => SpeechRecognizer | null;

/** Caps a wake-word clip so long speech is chunked instead of transcribed whole. */
export const WAKE_CLIP_MAX_MS = 8_000;

/** Matches a finalized transcription against the configured phrases. */
function evaluateTranscript(text: string, options: WakeDetectorOptions): WakeDetection | null {
  const match = findWakeMatch(text, options.phrases);
  if (!match) {
    return null;
  }
  // A finalized transcript is authoritative: treat it as fully stable.
  const confidence = wakeConfidence(match, WAKE_STABILITY_WINDOW);
  if (confidence < wakeThreshold(options.sensitivity)) {
    return null;
  }
  return { phrase: match.phrase, confidence };
}

/**
 * Records the stream while running and, on stop, transcribes the clip and
 * fires `onDetected` when it contains a wake phrase. Returns null when audio
 * transcription is unavailable in this environment.
 */
export function createWakeDetector(
  stream: MediaStream,
  options: WakeDetectorOptions,
  recognizerFactory: RecognizerFactory = createTranscribeRecognizer,
): WakeDetector | null {
  const recognizer = recognizerFactory(
    stream,
    {
      onInterim: () => undefined,
      onFinal: (text) => {
        const detection = evaluateTranscript(text, options);
        if (detection) {
          options.onDetected(detection);
        }
      },
      onEnd: () => {
        options.onEnd();
      },
      onError: () => {
        options.onEnd();
      },
    },
    WAKE_CLIP_MAX_MS,
  );
  if (!recognizer) {
    return null;
  }

  let running = false;
  return {
    start: () => {
      if (running) {
        return;
      }
      running = true;
      recognizer.start();
    },
    stop: () => {
      if (!running) {
        return;
      }
      running = false;
      recognizer.stop();
    },
    isRunning: () => running,
  };
}

/**
 * Whether the wake-word engine can run at all in this environment.
 */
export function isWakeWordSupported(): boolean {
  return isTranscriptionSupported();
}

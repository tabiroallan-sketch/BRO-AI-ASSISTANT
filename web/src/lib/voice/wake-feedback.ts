/**
 * Audible wake-word feedback (Stage 6): a short two-tone chime played through
 * Web Audio. The browser bits are isolated so the engine can inject a no-op
 * chime under test.
 */

export type WakeChime = () => void;

export type ChimeContext = {
  createOscillator: () => {
    type: OscillatorType;
    frequency: { value: number };
    connect: (node: unknown) => void;
    start: (when?: number) => void;
    stop: (when?: number) => void;
  };
  createGain: () => {
    gain: { value: number };
    connect: (node: unknown) => void;
  };
  destination: unknown;
  currentTime: number;
};

/** Plays the wake chime when an audio context is available. */
export function playWakeChime(context: ChimeContext | null): boolean {
  if (!context) {
    return false;
  }
  const now = context.currentTime;
  const tones = [660, 880];
  for (const [index, frequency] of tones.entries()) {
    const oscillator = context.createOscillator();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    const gain = context.createGain();
    gain.gain.value = 0.06;
    oscillator.connect(gain);
    gain.connect(context.destination);
    const start = now + index * 0.09;
    oscillator.start(start);
    oscillator.stop(start + 0.09);
  }
  return true;
}

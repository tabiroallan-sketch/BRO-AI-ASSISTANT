/**
 * Shared live voice level (0..1).
 *
 * Written by the listening/wake engines whenever the mic is hot (listening or
 * hearing), read imperatively by the WebGL core scene in its render loop so
 * the sphere can pulse with the actual voice without triggering React renders.
 */
let level = 0;

export const voiceLevel = {
  get: (): number => level,
  set: (next: number): void => {
    level = Math.max(0, Math.min(1, next));
  },
};

/**
 * Live microphone amplitude singleton (0..1), written by the Web Audio
 * analyser in Milestone 6 and read imperatively by the 3D scene each frame.
 * `level` is the raw reading; `smoothed` is a filtered value for driving
 * animations without jitter.
 */
export const audioLevel = {
  level: 0,
  smoothed: 0,
};

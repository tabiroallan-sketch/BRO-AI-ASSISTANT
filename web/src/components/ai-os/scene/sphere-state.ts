import type { AiState } from '@/lib/ai-state';

/**
 * Per-state animation parameters for the holographic sphere.
 * All values are smoothed toward their targets so transitions never jump.
 */
export type SphereParams = {
  /** Base rotation speed of the core. */
  speed: number;
  /** Intensity multiplier driving shader glow, ring opacity and pulses. */
  intensity: number;
  /** Multiplier for orbit-ring and neural activity speed. */
  ringSpeed: number;
  /** Seconds between spontaneous energy pulses. */
  pulsePeriod: number;
};

export const STATE_PARAMS: Record<AiState, SphereParams> = {
  idle: { speed: 0.12, intensity: 1.0, ringSpeed: 0.35, pulsePeriod: 5.2 },
  listening: { speed: 0.18, intensity: 1.25, ringSpeed: 0.6, pulsePeriod: 3.0 },
  thinking: { speed: 0.34, intensity: 1.5, ringSpeed: 1.1, pulsePeriod: 1.8 },
  speaking: { speed: 0.26, intensity: 1.4, ringSpeed: 0.8, pulsePeriod: 2.4 },
  executing: { speed: 0.42, intensity: 1.6, ringSpeed: 1.35, pulsePeriod: 1.2 },
  success: { speed: 0.2, intensity: 1.35, ringSpeed: 0.7, pulsePeriod: 3.2 },
  warning: { speed: 0.16, intensity: 1.28, ringSpeed: 0.5, pulsePeriod: 2.6 },
  error: { speed: 0.15, intensity: 1.42, ringSpeed: 0.45, pulsePeriod: 2.0 },
};

export const STATE_COLORS: Record<AiState, string> = {
  idle: '#22d3ee',
  listening: '#22d3ee',
  thinking: '#a855f7',
  speaking: '#3b82f6',
  executing: '#3b82f6',
  success: '#34d399',
  warning: '#fbbf24',
  error: '#f87171',
};

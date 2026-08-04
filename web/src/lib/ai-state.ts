'use client';

import { create } from 'zustand';

/**
 * The current experiential state of the AI core.
 * Drives the sphere, particles, status bar and console in later milestones.
 * State transitions are smooth and never abrupt.
 */
export type AiState =
  'idle' | 'listening' | 'thinking' | 'speaking' | 'executing' | 'success' | 'warning' | 'error';

export const AI_STATE_LABELS: Record<AiState, string> = {
  idle: 'Idle',
  listening: 'Listening',
  thinking: 'Thinking',
  speaking: 'Speaking',
  executing: 'Executing',
  success: 'Success',
  warning: 'Warning',
  error: 'Error',
};

export const AI_STATE_COLORS: Record<AiState, string> = {
  idle: 'text-neon-cyan',
  listening: 'text-neon-cyan',
  thinking: 'text-neon-purple',
  speaking: 'text-neon-blue',
  executing: 'text-neon-blue',
  success: 'text-emerald-400',
  warning: 'text-amber-400',
  error: 'text-red-400',
};

type AiStateStore = {
  state: AiState;
  /** 0..1 overall progress of the current task. */
  taskProgress: number;
  /** Name of the tool currently executing, or null. */
  activeTool: string | null;
  setState: (state: AiState) => void;
  setTaskProgress: (progress: number) => void;
  setActiveTool: (tool: string | null) => void;
};

export const useAiState = create<AiStateStore>((set) => ({
  state: 'idle',
  taskProgress: 0,
  activeTool: null,
  setState: (state) => set({ state }),
  setTaskProgress: (taskProgress) => set({ taskProgress }),
  setActiveTool: (activeTool) => set({ activeTool }),
}));

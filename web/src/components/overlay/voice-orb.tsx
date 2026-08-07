'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { useAiState } from '@/lib/ai-state';
import { cn } from '@/lib/utils';

const ACTIVE_STATES = new Set(['listening', 'thinking', 'speaking', 'executing']);

/**
 * Voice visualization (Stage 4): a small pulsing orb that reacts to the AI
 * core's activity. Listening glows cyan; thinking/speaking/executing shifts
 * toward purple. Stage 5 replaces the state-driven glow with a real audio
 * level visualization.
 */
export function VoiceOrb(): React.JSX.Element {
  const state = useAiState((store) => store.state);
  const reduceMotion = useReducedMotion();
  const active = ACTIVE_STATES.has(state);
  const listening = state === 'listening';
  const color = listening ? 'var(--neon-cyan)' : 'var(--neon-purple)';

  return (
    <div className="relative flex h-10 w-10 shrink-0 items-center justify-center" aria-hidden>
      {active && !reduceMotion && (
        <>
          <motion.span
            className="absolute inset-0 rounded-full border"
            style={{ borderColor: color }}
            initial={false}
            animate={{ scale: [1, 2], opacity: [0.7, 0] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: 'easeOut' }}
          />
          <motion.span
            className="absolute inset-0 rounded-full border"
            style={{ borderColor: color }}
            initial={false}
            animate={{ scale: [1, 2], opacity: [0.5, 0] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: 'easeOut', delay: 0.5 }}
          />
        </>
      )}
      <motion.span
        className={cn('block h-5 w-5 rounded-full', listening ? 'bg-neon-cyan' : 'bg-neon-purple')}
        style={{ boxShadow: `0 0 18px ${color}` }}
        initial={false}
        animate={active && !reduceMotion ? { scale: [1, 1.25, 1] } : { scale: 1 }}
        transition={{ duration: 0.9, repeat: Infinity, ease: 'easeInOut' }}
      />
    </div>
  );
}

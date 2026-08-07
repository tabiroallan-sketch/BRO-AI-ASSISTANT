'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { useAiState } from '@/lib/ai-state';
import { useVoice } from '@/hooks/use-voice';
import { cn } from '@/lib/utils';

const ACTIVE_STATES = new Set(['listening', 'thinking', 'speaking', 'executing']);

/**
 * Voice visualization (Stage 4, enhanced in Stage 5). While the engine is
 * listening the orb breathes with the live mic level; thinking/speaking and
 * the other experiential states keep the state-driven pulse/glow.
 */
export function VoiceOrb(): React.JSX.Element {
  const ai = useAiState((store) => store.state);
  const { state: voiceState } = useVoice();
  const reduceMotion = useReducedMotion();

  const active = ACTIVE_STATES.has(ai);
  const listening = ai === 'listening';
  // Flatten the live level so a silent mic keeps a faint baseline.
  const level = listening ? Math.max(0.12, voiceState.level) : 1;
  const color = listening ? 'var(--neon-cyan)' : 'var(--neon-purple)';

  return (
    <div className="relative flex h-10 w-10 shrink-0 items-center justify-center" aria-hidden>
      {active && !listening && !reduceMotion && (
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
      {listening && (
        <motion.span
          className="absolute inset-0 rounded-full border"
          style={{ borderColor: color, opacity: 0.35 + 0.45 * level }}
          initial={false}
          animate={{ scale: 1 + level }}
          transition={{ duration: 0.12, ease: 'linear' }}
        />
      )}
      <motion.span
        className={cn('block h-5 w-5 rounded-full', listening ? 'bg-neon-cyan' : 'bg-neon-purple')}
        style={{ boxShadow: `0 0 ${10 + 16 * level}px ${color}` }}
        initial={false}
        animate={
          listening
            ? { scale: 1 + 0.45 * level }
            : active && !reduceMotion
              ? { scale: [1, 1.25, 1] }
              : { scale: 1 }
        }
        transition={{
          duration: listening ? 0.12 : 0.9,
          repeat: listening ? 0 : Infinity,
          ease: 'easeInOut',
        }}
      />
    </div>
  );
}

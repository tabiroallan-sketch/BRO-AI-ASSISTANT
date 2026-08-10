'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { useAiState } from '@/lib/ai-state';
import { useVoice } from '@/hooks/use-voice';
import { cn } from '@/lib/utils';

const ACTIVE_STATES = new Set(['listening', 'thinking', 'speaking', 'executing']);

const SIZES = {
  sm: { box: 'h-10 w-10', dot: 'h-5 w-5' },
  lg: { box: 'h-24 w-24', dot: 'h-10 w-10' },
} as const;

/**
 * Voice visualization (Stage 4, enhanced in Stage 5/6). While the engine is
 * listening the orb breathes with the live mic level; thinking/speaking and
 * the other experiential states keep the state-driven pulse/glow. A one-shot
 * ring flash marks a wake-word trigger (Stage 6).
 */
export function VoiceOrb({ size = 'sm' }: { size?: keyof typeof SIZES }): React.JSX.Element {
  const ai = useAiState((store) => store.state);
  const { state: voiceState, wake } = useVoice();
  const reduceMotion = useReducedMotion();
  const box = SIZES[size];

  const active = ACTIVE_STATES.has(ai);
  const listening = ai === 'listening';
  // The wake engine is "hearing" whenever the VAD senses speech-like audio
  // while armed; breathe with that live level too so the sphere visibly reacts
  // to the voice even before the wake word is confirmed.
  const wakeHearing = wake.phase === 'hearing';
  const reacting = listening || wakeHearing;
  // Flatten the live level so a silent mic keeps a faint baseline.
  const level = reacting ? Math.max(0.12, listening ? voiceState.level : wake.level) : 1;
  const speaking = ai === 'speaking';
  const color = speaking
    ? 'var(--neon-blue)'
    : reacting
      ? 'var(--neon-cyan)'
      : 'var(--neon-purple)';

  return (
    <div className={`relative flex ${box.box} shrink-0 items-center justify-center`} aria-hidden>
      {wake.lastTriggerId > 0 && (
        <motion.span
          key={`wake-${wake.lastTriggerId}`}
          className="absolute inset-0 rounded-full border-2 border-neon-cyan"
          initial={{ scale: 1, opacity: 0.9 }}
          animate={{ scale: 2.6, opacity: 0 }}
          transition={{ duration: 0.7, ease: 'easeOut' }}
        />
      )}
      {active && !reacting && !reduceMotion && (
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
      {reacting && (
        <motion.span
          className="absolute inset-0 rounded-full border"
          style={{ borderColor: color, opacity: 0.35 + 0.45 * level }}
          initial={false}
          animate={{ scale: 1 + level }}
          transition={{ duration: 0.12, ease: 'linear' }}
        />
      )}
      <motion.span
        className={cn(
          'block rounded-full',
          speaking ? 'bg-neon-blue' : reacting ? 'bg-neon-cyan' : 'bg-neon-purple',
          box.dot,
        )}
        style={{ boxShadow: `0 0 ${10 + 16 * level}px ${color}` }}
        initial={false}
        animate={
          reacting
            ? { scale: 1 + 0.45 * level }
            : active && !reduceMotion
              ? { scale: [1, 1.25, 1] }
              : { scale: 1 }
        }
        transition={{
          duration: reacting ? 0.12 : 0.9,
          repeat: reacting ? 0 : Infinity,
          ease: 'easeInOut',
        }}
      />
    </div>
  );
}

'use client';

import * as React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { X } from 'lucide-react';

/**
 * A floating HUD panel for the AI OS: glass chrome, free drag within the
 * viewport (with slight elastic overshoot), spring entrance, and a close
 * button. Used by the floating layer to overlay live data on the 3D stage.
 */
export function FloatingPanel({
  title,
  accent = 'text-neon-cyan',
  defaultPosition,
  onClose,
  children,
}: {
  title: string;
  accent?: string;
  defaultPosition: { x: number; y: number };
  onClose: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  const reduceMotion = useReducedMotion();
  const constraintsRef = React.useRef<HTMLDivElement>(null);

  return (
    <div ref={constraintsRef} className="pointer-events-none absolute inset-0">
      <motion.section
        drag
        dragConstraints={constraintsRef}
        dragElastic={0.15}
        dragMomentum={false}
        whileDrag={reduceMotion ? undefined : { scale: 1.03 }}
        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -14, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 320, damping: 26 }}
        className="pointer-events-auto absolute w-64 rounded-xl border border-white/10 bg-background/55 shadow-[0_0_30px_color-mix(in_oklab,var(--neon-cyan)_18%,transparent)] backdrop-blur-xl"
        style={{ left: defaultPosition.x, top: defaultPosition.y }}
      >
        <header className="flex cursor-grab select-none items-center justify-between border-b border-white/10 px-3 py-2 active:cursor-grabbing">
          <div className="flex items-center gap-2 font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            <span className={`h-1.5 w-1.5 rounded-full bg-current ${accent}`} />
            {title}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={`Close ${title} panel`}
            className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </header>
        <div className="p-3">{children}</div>
      </motion.section>
    </div>
  );
}

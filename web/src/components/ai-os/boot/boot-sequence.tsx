'use client';

import * as React from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useStatusFeed } from '@/lib/status-feed';

const BOOT_LINES = [
  'initializing neural lattice',
  'syncing memory banks',
  'calibrating holographic optics',
  'linking voice cortex',
  'all systems nominal',
];

const BOOT_KEY = 'bro-os-booted';
const WELCOME_KEY = 'bro-os-welcome';

/**
 * One-shot "system boot" splash shown on the first OS visit of a session: a
 * wordmark, a fast progress bar and cycling boot lines that fade out to
 * reveal the stage. Skipped entirely for reduced-motion users. Fires a
 * first-run welcome toast once the OS is ready.
 */
export function BootSequence(): React.JSX.Element | null {
  const reduceMotion = useReducedMotion();
  const [visible, setVisible] = React.useState(false);
  const [line, setLine] = React.useState(0);
  const [progress, setProgress] = React.useState(0);
  const welcomeSent = React.useRef(false);

  const sendWelcome = React.useCallback(() => {
    if (welcomeSent.current) {
      return;
    }
    welcomeSent.current = true;
    let alreadySent = false;
    try {
      alreadySent = sessionStorage.getItem(WELCOME_KEY) === '1';
      if (!alreadySent) {
        sessionStorage.setItem(WELCOME_KEY, '1');
      }
    } catch {
      /* session storage unavailable */
    }
    if (!alreadySent) {
      useStatusFeed
        .getState()
        .push('info', 'BRO OS ready', 'Press Ctrl+K to open the command console.');
    }
  }, []);

  React.useEffect(() => {
    if (reduceMotion) {
      sendWelcome();
      return undefined;
    }
    let booted = false;
    try {
      booted = sessionStorage.getItem(BOOT_KEY) === '1';
    } catch {
      /* session storage unavailable */
    }
    if (booted) {
      sendWelcome();
      return undefined;
    }

    setVisible(true);
    const lineTimer = window.setInterval(
      () => setLine((current) => Math.min(BOOT_LINES.length - 1, current + 1)),
      420,
    );
    const progressTimer = window.setInterval(
      () => setProgress((current) => Math.min(100, current + 7 + Math.random() * 9)),
      90,
    );
    const done = window.setTimeout(() => {
      window.clearInterval(lineTimer);
      window.clearInterval(progressTimer);
      try {
        sessionStorage.setItem(BOOT_KEY, '1');
      } catch {
        /* session storage unavailable */
      }
      setVisible(false);
      sendWelcome();
    }, 1500);

    return () => {
      window.clearInterval(lineTimer);
      window.clearInterval(progressTimer);
      window.clearTimeout(done);
    };
  }, [reduceMotion, sendWelcome]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-6 bg-background"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5 }}
          aria-hidden="true"
        >
          <div className="font-mono text-4xl font-bold tracking-[0.3em] text-foreground">
            BRO<span className="text-neon-cyan">_</span>
          </div>
          <div className="w-64">
            <div className="h-1 w-full overflow-hidden rounded-full bg-foreground/10">
              <div
                className="h-full rounded-full bg-gradient-to-r from-neon-cyan to-neon-purple"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
          <div className="h-4 font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
            {BOOT_LINES[line]}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

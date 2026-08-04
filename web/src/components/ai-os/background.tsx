'use client';

/**
 * Ambient backdrop for the AI OS shell, split into two layers:
 *  - A CSS nebula glow that sits BEHIND the WebGL stage (visible through
 *    the transparent canvas) and is the fallback when WebGL is unavailable.
 *  - A HUD overlay (grid, scanline, vignette) that sits ABOVE the stage so
 *    the holographic scene reads as being inside an instrument panel.
 */
export function AiBackground(): React.JSX.Element {
  return (
    <>
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-background"
      >
        <div className="absolute -left-40 -top-40 h-[38rem] w-[38rem] animate-drift rounded-full bg-neon-blue/20 blur-[130px]" />
        <div className="absolute -right-44 top-1/3 h-[36rem] w-[36rem] animate-drift rounded-full bg-neon-purple/20 blur-[130px] [animation-delay:-8s]" />
        <div className="absolute -bottom-52 left-1/3 h-[34rem] w-[34rem] animate-drift rounded-full bg-neon-cyan/15 blur-[130px] [animation-delay:-16s]" />
      </div>
      <div aria-hidden className="pointer-events-none fixed inset-0 z-[2] overflow-hidden">
        <div className="hud-grid absolute inset-0 animate-hud-pan opacity-70" />
        <div className="absolute inset-x-0 top-0 h-40 animate-scanline bg-gradient-to-b from-neon-cyan/5 to-transparent" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_35%,rgba(0,0,0,0.6)_100%)]" />
      </div>
    </>
  );
}

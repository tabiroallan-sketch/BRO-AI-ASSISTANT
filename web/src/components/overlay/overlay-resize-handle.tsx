'use client';

import * as React from 'react';
import { getDesktopApi } from '@/lib/desktop';
import { clampOverlaySize } from '@/lib/overlay';

/**
 * Bottom-right resize grip for the frameless overlay. Reports pointer deltas to
 * the main process, which resizes the window while keeping its top-left corner
 * fixed. Hidden when the desktop bridge is unavailable (plain browser).
 */
export function OverlayResizeHandle(): React.JSX.Element | null {
  const api = getDesktopApi();
  const dragRef = React.useRef<{
    startX: number;
    startY: number;
    width: number;
    height: number;
    pointerId: number;
  } | null>(null);
  const frameRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    return () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
      }
    };
  }, []);

  if (!api) {
    return null;
  }
  const overlay = api.overlay;

  function commit(): void {
    frameRef.current = null;
    const drag = dragRef.current;
    if (!drag) {
      return;
    }
    const size = clampOverlaySize(drag.width, drag.height);
    overlay.resize(size.width, size.height);
  }

  function schedule(): void {
    if (frameRef.current === null) {
      frameRef.current = requestAnimationFrame(commit);
    }
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>): void {
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      width: window.innerWidth,
      height: window.innerHeight,
      pointerId: event.pointerId,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>): void {
    const drag = dragRef.current;
    if (!drag) {
      return;
    }
    drag.width = drag.width + (event.clientX - drag.startX);
    drag.height = drag.height + (event.clientY - drag.startY);
    drag.startX = event.clientX;
    drag.startY = event.clientY;
    schedule();
  }

  function onPointerUp(event: React.PointerEvent<HTMLDivElement>): void {
    dragRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      aria-label="Resize overlay"
      className="absolute bottom-0 right-0 h-4 w-4 cursor-se-resize"
      style={{ touchAction: 'none', WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      <div className="absolute bottom-1 right-1 h-2 w-2 rounded-[2px] border-b border-r border-muted-foreground/50" />
    </div>
  );
}

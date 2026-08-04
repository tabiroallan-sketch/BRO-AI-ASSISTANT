'use client';

import * as React from 'react';
import { useThree } from '@react-three/fiber';

/**
 * Performance safeguards for the WebGL stage:
 * - Pauses the render loop entirely while the tab is hidden (biggest win on
 *   laptops; the browser throttles rAF anyway, but `frameloop='never'`
 *   also stops all GPU work).
 * - Resumes automatically when the tab becomes visible again.
 */
export function PerformanceGate(): null {
  const setFrameloop = useThree((state) => state.setFrameloop);

  React.useEffect(() => {
    const onVisibility = (): void => {
      setFrameloop(document.hidden ? 'never' : 'always');
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      setFrameloop('always');
    };
  }, [setFrameloop]);

  return null;
}

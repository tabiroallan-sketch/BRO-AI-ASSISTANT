'use client';

import * as React from 'react';
import dynamic from 'next/dynamic';
import { initScenePointer } from '@/lib/scene-pointer';
import { supportsWebGL } from '@/lib/webgl';

const CoreScene = dynamic(() => import('@/components/ai-os/scene/core-scene'), {
  ssr: false,
  loading: () => null,
});

/**
 * The WebGL stage of the AI OS shell.
 * Lazy-loaded after first paint so the three.js payload never blocks the UI;
 * renders nothing when WebGL is unavailable (the CSS backdrop remains).
 */
export default function AiScene(): React.JSX.Element {
  const [enabled, setEnabled] = React.useState(false);

  React.useEffect(() => {
    setEnabled(supportsWebGL());
    const cleanupPointer = initScenePointer();
    return cleanupPointer;
  }, []);

  if (!enabled) {
    return <></>;
  }

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0">
      <CoreScene />
    </div>
  );
}

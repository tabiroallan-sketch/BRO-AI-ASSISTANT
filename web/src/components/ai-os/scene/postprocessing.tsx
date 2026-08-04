'use client';

import * as React from 'react';
import { Bloom, EffectComposer, Noise, Vignette } from '@react-three/postprocessing';
import { useReducedMotion } from 'framer-motion';

/**
 * Post-processing chain for the stage: neon bloom to make the holographic
 * layers glow, a cinematic vignette, and a whisper of film grain (skipped for
 * reduced-motion users). Multisampling is disabled and bloom uses mipmap
 * blur so the whole chain stays light on weak GPUs.
 */
export function PostEffects(): React.JSX.Element {
  const reduceMotion = useReducedMotion();

  return (
    <EffectComposer multisampling={0}>
      <Bloom
        intensity={0.9}
        luminanceThreshold={0.15}
        luminanceSmoothing={0.3}
        mipmapBlur
        radius={0.7}
      />
      <Vignette eskil={false} offset={0.22} darkness={0.72} />
      <Noise opacity={reduceMotion ? 0 : 0.035} premultiply />
    </EffectComposer>
  );
}

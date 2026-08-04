'use client';

import * as React from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { AdaptiveDpr } from '@react-three/drei';
import { useReducedMotion } from 'framer-motion';
import { EnergyPulses } from './energy-pulses';
import { HoloSphere } from './holo-sphere';
import { NeuralNet } from './neural-net';
import { OrbitRings } from './orbit-rings';
import { ParticleField } from './particle-field';

const NEON_CYAN = '#22d3ee';
const NEON_BLUE = '#3b82f6';
const NEON_PURPLE = '#a855f7';

/** Slow, cinematic idle orbit around the core. Reduced-motion users get a static frame. */
function CameraRig(): null {
  const { camera } = useThree();
  const reduceMotion = useReducedMotion();

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (reduceMotion) {
      camera.position.set(0, 0, 6.4);
    } else {
      const radius = 6.4;
      camera.position.set(
        Math.sin(t * 0.14) * radius,
        Math.sin(t * 0.06) * 1.6,
        Math.cos(t * 0.14) * radius,
      );
    }
    camera.lookAt(0, 0, 0);
  });

  return null;
}

/** Lighting rig for the stage: soft ambient, cyan key, purple rim, blue fill. */
function Lights(): React.JSX.Element {
  return (
    <>
      <ambientLight intensity={0.5} />
      <pointLight position={[4.5, 2.5, 4]} color={NEON_CYAN} intensity={16} distance={24} />
      <pointLight position={[-4.5, -2, 3.5]} color={NEON_PURPLE} intensity={12} distance={24} />
      <directionalLight position={[0, 6, -6]} color={NEON_BLUE} intensity={1.4} />
    </>
  );
}

export default function CoreScene(): React.JSX.Element {
  return (
    <Canvas
      dpr={[1, 1.5]}
      camera={{ fov: 45, near: 0.1, far: 100, position: [0, 0, 6.4] }}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
    >
      <AdaptiveDpr pixelated={false} />
      <Lights />
      <CameraRig />
      <HoloSphere />
      <OrbitRings />
      <EnergyPulses />
      <ParticleField />
      <NeuralNet />
    </Canvas>
  );
}

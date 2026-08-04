'use client';

import * as React from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { AdaptiveDpr } from '@react-three/drei';
import { useReducedMotion } from 'framer-motion';
import { EnergyPulses } from './energy-pulses';
import { HoloSphere } from './holo-sphere';
import { NeuralNet } from './neural-net';
import { OrbitRings } from './orbit-rings';
import { ParticleField } from './particle-field';
import { PostEffects } from './postprocessing';
import { useAiState } from '@/lib/ai-state';
import { STATE_COLORS, STATE_PARAMS } from './sphere-state';

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

/** Lighting rig for the stage: soft ambient, cyan key, purple rim, blue fill.
 * Key and rim lights drift slowly and tint toward the current AI state color,
 * brightening during intense states. Reduced-motion users get a static rig. */
function LightRig(): React.JSX.Element {
  const keyRef = React.useRef<THREE.PointLight>(null);
  const rimRef = React.useRef<THREE.PointLight>(null);
  const reduceMotion = useReducedMotion();
  const current = React.useRef({
    intensity: 1,
    color: new THREE.Color(NEON_CYAN),
  });
  const targetColor = React.useRef(new THREE.Color());

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05);
    const ai = useAiState.getState();
    const target = STATE_PARAMS[ai.state];
    targetColor.current.set(STATE_COLORS[ai.state]);

    const cur = current.current;
    cur.intensity = THREE.MathUtils.damp(cur.intensity, 0.8 + target.intensity * 0.6, 2, dt);
    cur.color.lerp(targetColor.current, 1 - Math.pow(0.0005, dt));

    const key = keyRef.current;
    const rim = rimRef.current;
    if (!key || !rim) {
      return;
    }

    if (reduceMotion) {
      key.position.set(4.5, 2.5, 4);
      rim.position.set(-4.5, -2, 3.5);
    } else {
      const t = state.clock.elapsedTime;
      key.position.set(
        4.5 + Math.sin(t * 0.3) * 0.5,
        2.5 + Math.sin(t * 0.21) * 0.4,
        4 + Math.cos(t * 0.27) * 0.5,
      );
      rim.position.set(
        -4.5 + Math.cos(t * 0.24) * 0.6,
        -2 + Math.sin(t * 0.18) * 0.4,
        3.5 + Math.sin(t * 0.3) * 0.5,
      );
    }

    key.intensity = 16 * cur.intensity;
    key.color.copy(cur.color);
    rim.intensity = 12 * cur.intensity;
    rim.color.copy(cur.color);
  });

  return (
    <>
      <ambientLight intensity={0.5} />
      <pointLight
        ref={keyRef}
        color={NEON_CYAN}
        intensity={16}
        distance={24}
        position={[4.5, 2.5, 4]}
      />
      <pointLight
        ref={rimRef}
        color={NEON_PURPLE}
        intensity={12}
        distance={24}
        position={[-4.5, -2, 3.5]}
      />
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
      <LightRig />
      <CameraRig />
      <HoloSphere />
      <OrbitRings />
      <EnergyPulses />
      <ParticleField />
      <NeuralNet />
      <PostEffects />
    </Canvas>
  );
}

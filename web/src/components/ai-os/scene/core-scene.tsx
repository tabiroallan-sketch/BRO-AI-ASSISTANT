'use client';

import * as React from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { AdaptiveDpr } from '@react-three/drei';
import { useReducedMotion } from 'framer-motion';

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

/**
 * Placeholder for the Milestone 3 holographic sphere.
 * A slow-turning wireframe core with an additive glow shell, kept intentionally
 * lightweight so the stage is verifiable before the real sphere lands.
 */
function PlaceholderCore(): React.JSX.Element {
  const wire = React.useRef<THREE.Mesh>(null);
  const glow = React.useRef<THREE.Mesh>(null);
  const reduceMotion = useReducedMotion();

  useFrame((_state, delta) => {
    if (reduceMotion) {
      return;
    }
    if (wire.current) {
      wire.current.rotation.y += delta * 0.22;
      wire.current.rotation.x += delta * 0.07;
    }
    if (glow.current) {
      const pulse = 1 + Math.sin(_state.clock.elapsedTime * 0.9) * 0.04;
      glow.current.scale.setScalar(pulse);
    }
  });

  return (
    <group>
      <mesh ref={wire}>
        <icosahedronGeometry args={[1.35, 1]} />
        <meshStandardMaterial
          color={NEON_CYAN}
          wireframe
          transparent
          opacity={0.55}
          emissive={NEON_BLUE}
          emissiveIntensity={0.5}
        />
      </mesh>
      <mesh ref={glow}>
        <sphereGeometry args={[1.7, 32, 32]} />
        <meshBasicMaterial
          color={NEON_CYAN}
          transparent
          opacity={0.12}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      <pointLight color={NEON_CYAN} intensity={9} distance={14} />
    </group>
  );
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
      <PlaceholderCore />
    </Canvas>
  );
}

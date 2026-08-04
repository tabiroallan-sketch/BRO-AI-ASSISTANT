'use client';

import * as React from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useReducedMotion } from 'framer-motion';
import { useAiState } from '@/lib/ai-state';
import { NEON_BLUE, NEON_CYAN } from './colors';
import { STATE_COLORS, STATE_PARAMS } from './sphere-state';

type RingConfig = {
  radius: number;
  tiltX: number;
  tiltY: number;
  speed: number;
  opacity: number;
  pulseCount: number;
  tube: number;
};

const RINGS: RingConfig[] = [
  {
    radius: 2.1,
    tiltX: Math.PI / 2.4,
    tiltY: 0.4,
    speed: 0.35,
    opacity: 0.35,
    pulseCount: 1,
    tube: 0.015,
  },
  {
    radius: 2.55,
    tiltX: Math.PI / 2.8,
    tiltY: 0.9,
    speed: -0.24,
    opacity: 0.26,
    pulseCount: 2,
    tube: 0.012,
  },
  {
    radius: 3.0,
    tiltX: Math.PI / 2.2,
    tiltY: -0.3,
    speed: 0.18,
    opacity: 0.2,
    pulseCount: 1,
    tube: 0.01,
  },
];

/**
 * Three holographic rings orbiting the core, each tilting independently and
 * carrying glowing pulses that travel along their circumference. Ring speed
 * and pulse color react to the AI state.
 */
export function OrbitRings(): React.JSX.Element {
  const ringRefs = React.useRef<Array<THREE.Mesh | null>>([]);
  const groupRefs = React.useRef<Array<THREE.Group | null>>([]);
  const pulseRefs = React.useRef<Array<THREE.Mesh | null>>([]);
  const reduceMotion = useReducedMotion();

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const ai = useAiState.getState();
    const ringSpeed = STATE_PARAMS[ai.state].ringSpeed;
    const color = STATE_COLORS[ai.state];
    const motion = reduceMotion ? 0 : 1;

    RINGS.forEach((ring, i) => {
      const ringGroup = groupRefs.current[i];
      if (ringGroup) {
        ringGroup.rotation.x = ring.tiltX + Math.sin(t * 0.18 + i * 1.7) * 0.06 * motion;
        ringGroup.rotation.y = ring.tiltY + Math.cos(t * 0.13 + i * 2.1) * 0.04 * motion;
      }
      const ringMesh = ringRefs.current[i];
      if (ringMesh) {
        (ringMesh.material as THREE.MeshBasicMaterial).color.set(color);
        (ringMesh.material as THREE.MeshBasicMaterial).opacity =
          ring.opacity * (0.7 + STATE_PARAMS[ai.state].intensity * 0.3);
      }
      for (let p = 0; p < ring.pulseCount; p += 1) {
        const index = RINGS.slice(0, i).reduce((sum, r) => sum + r.pulseCount, 0) + p;
        const pulse = pulseRefs.current[index];
        if (!pulse) {
          continue;
        }
        const angle =
          t * ring.speed * ringSpeed * 1.6 + (p * Math.PI * 2) / ring.pulseCount + i * 2.1;
        pulse.position.set(Math.cos(angle) * ring.radius, Math.sin(angle) * ring.radius, 0);
        (pulse.material as THREE.MeshBasicMaterial).color.set(color);
      }
    });
  });

  return (
    <group>
      {RINGS.map((ring, i) => (
        <group
          key={ring.radius}
          rotation={[ring.tiltX, ring.tiltY, 0]}
          ref={(node) => (groupRefs.current[i] = node)}
        >
          <mesh ref={(node) => (ringRefs.current[i] = node)}>
            <torusGeometry args={[ring.radius, ring.tube, 8, 96]} />
            <meshBasicMaterial
              color={NEON_CYAN}
              transparent
              opacity={ring.opacity}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          </mesh>
          {Array.from({ length: ring.pulseCount }).map((_, p) => {
            const pulseIndex = RINGS.slice(0, i).reduce((sum, r) => sum + r.pulseCount, 0) + p;
            return (
              <mesh key={p} ref={(node) => (pulseRefs.current[pulseIndex] = node)}>
                <sphereGeometry args={[0.06, 12, 12]} />
                <meshBasicMaterial
                  color={NEON_BLUE}
                  transparent
                  blending={THREE.AdditiveBlending}
                  depthWrite={false}
                  toneMapped={false}
                />
              </mesh>
            );
          })}
        </group>
      ))}
    </group>
  );
}

'use client';

import * as React from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useReducedMotion } from 'framer-motion';
import { useAiState, type AiState } from '@/lib/ai-state';
import { NEON_CYAN } from './colors';
import { STATE_COLORS, STATE_PARAMS } from './sphere-state';

const PULSE_DURATION = 1.15;
const PULSE_COUNT = 3;

type Wave = {
  mesh: THREE.Mesh | null;
  start: number;
  color: THREE.Color;
};

/**
 * Expanding holographic shockwaves. Fired on every AI-state transition and
 * periodically at a rate that follows the current state (faster while the AI
 * is thinking/executing, slow when idle).
 */
export function EnergyPulses(): React.JSX.Element {
  const waves = React.useRef<Wave[]>(
    Array.from({ length: PULSE_COUNT }, () => ({
      mesh: null,
      start: -10,
      color: new THREE.Color(NEON_CYAN),
    })),
  );
  const lastState = React.useRef<AiState>('idle');
  const nextPulseAt = React.useRef(0);
  const reduceMotion = useReducedMotion();

  const fire = React.useCallback((now: number, baseDelay: number): void => {
    const ai = useAiState.getState();
    const color = STATE_COLORS[ai.state];
    waves.current.forEach((wave, i) => {
      if (!wave.mesh) {
        return;
      }
      wave.start = now + baseDelay + i * 0.12;
      wave.color.set(color);
      wave.mesh.visible = true;
    });
  }, []);

  useFrame((state) => {
    const now = state.clock.elapsedTime;
    const ai = useAiState.getState();

    if (ai.state !== lastState.current) {
      lastState.current = ai.state;
      fire(now, 0);
    }
    if (now >= nextPulseAt.current) {
      nextPulseAt.current = now + STATE_PARAMS[ai.state].pulsePeriod;
      fire(now, 0);
    }

    const motion = reduceMotion ? 0 : 1;
    waves.current.forEach((wave) => {
      const mesh = wave.mesh;
      if (!mesh) {
        return;
      }
      const progress = motion === 0 ? 1 : (now - wave.start) / PULSE_DURATION;
      if (progress >= 1 || progress < 0) {
        mesh.visible = false;
        return;
      }
      const eased = 1 - Math.pow(1 - progress, 3);
      const scale = 0.7 + eased * 3.2;
      mesh.scale.setScalar(scale);
      const material = mesh.material as THREE.MeshBasicMaterial;
      material.opacity = (1 - progress) * 0.55;
      material.color.copy(wave.color);
    });
  });

  return (
    <group>
      {waves.current.map((wave, i) => (
        <mesh
          key={i}
          ref={(node) => (wave.mesh = node)}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, (i - 1) * 0.5, 0]}
          visible={false}
        >
          <ringGeometry args={[0.9, 0.95, 64]} />
          <meshBasicMaterial
            color={NEON_CYAN}
            transparent
            opacity={0}
            side={THREE.DoubleSide}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      ))}
    </group>
  );
}

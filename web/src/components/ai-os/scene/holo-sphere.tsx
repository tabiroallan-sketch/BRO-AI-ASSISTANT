'use client';

import * as React from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useReducedMotion } from 'framer-motion';
import { useAiState } from '@/lib/ai-state';
import { scenePointer } from '@/lib/scene-pointer';
import { NEON_CYAN, NEON_PURPLE } from './colors';
import { STATE_COLORS, STATE_PARAMS } from './sphere-state';

const VERTEX = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vViewDir;
  varying vec3 vPos;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vViewDir = normalize(-mvPosition.xyz);
    vPos = position;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uIntensity;
  varying vec3 vNormal;
  varying vec3 vViewDir;
  varying vec3 vPos;

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  float noise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i), hash(i + vec3(1.0, 0.0, 0.0)), f.x),
          mix(hash(i + vec3(0.0, 1.0, 0.0)), hash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
      mix(mix(hash(i + vec3(0.0, 0.0, 1.0)), hash(i + vec3(1.0, 0.0, 1.0)), f.x),
          mix(hash(i + vec3(0.0, 1.0, 1.0)), hash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
      f.z);
  }

  void main() {
    float fresnel = pow(1.0 - abs(dot(normalize(vNormal), normalize(vViewDir))), 2.2);
    float n = noise(vPos * 2.4 + vec3(0.0, uTime * 0.35, 0.0));
    float bands = 0.5 + 0.5 * sin(vPos.y * 7.0 + uTime * 1.4);
    float glow = fresnel * (1.5 + n * 1.2) * uIntensity + bands * 0.1 * uIntensity;
    vec3 col = uColor * (0.1 + glow);
    float alpha = clamp(glow, 0.0, 1.0) * 0.85;
    gl_FragColor = vec4(col, alpha);
  }
`;

/**
 * The holographic sphere at the heart of BRO.
 * A custom animated fresnel/noise shader forms the energy shell, a wireframe
 * lattice and an outer floating layer add depth, and everything eases toward
 * per-AI-state targets (speed, intensity, color). The core tilts toward the
 * cursor for an interactive feel and never stops moving.
 */
export function HoloSphere(): React.JSX.Element {
  const group = React.useRef<THREE.Group>(null);
  const wire = React.useRef<THREE.Mesh>(null);
  const layer = React.useRef<THREE.Mesh>(null);
  const material = React.useRef<THREE.ShaderMaterial>(null);
  const reduceMotion = useReducedMotion();

  const current = React.useRef({
    speed: STATE_PARAMS.idle.speed,
    intensity: STATE_PARAMS.idle.intensity,
    color: new THREE.Color(STATE_COLORS.idle),
  });
  const targetColor = React.useRef(new THREE.Color());

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05);
    const ai = useAiState.getState();
    const target = STATE_PARAMS[ai.state];
    targetColor.current.set(STATE_COLORS[ai.state]);

    const cur = current.current;
    cur.speed = THREE.MathUtils.damp(cur.speed, target.speed, 2.0, dt);
    cur.intensity = THREE.MathUtils.damp(cur.intensity, target.intensity, 3.0, dt);
    cur.color.lerp(targetColor.current, 1 - Math.pow(0.0005, dt));

    const motion = reduceMotion ? 0 : 1;

    if (material.current) {
      material.current.uniforms.uTime.value += dt * cur.speed * 4 * motion;
      material.current.uniforms.uIntensity.value = cur.intensity;
      (material.current.uniforms.uColor.value as THREE.Color).copy(cur.color);
    }

    if (wire.current) {
      wire.current.rotation.y += dt * cur.speed * 1.2 * motion;
      wire.current.rotation.x += dt * cur.speed * 0.4 * motion;
      const wireMaterial = wire.current.material as THREE.MeshBasicMaterial;
      wireMaterial.color.copy(cur.color);
      wireMaterial.opacity = 0.1 + cur.intensity * 0.05;
    }

    if (layer.current) {
      layer.current.rotation.y -= dt * cur.speed * 0.6 * motion;
    }

    if (group.current) {
      group.current.rotation.y += dt * cur.speed * motion;
      const tiltX = scenePointer.y * 0.35;
      const tiltZ = scenePointer.x * 0.25;
      group.current.rotation.x = THREE.MathUtils.damp(group.current.rotation.x, tiltX, 2.5, dt);
      group.current.rotation.z = THREE.MathUtils.damp(group.current.rotation.z, tiltZ, 2.5, dt);
    }
  });

  return (
    <group ref={group}>
      <mesh>
        <sphereGeometry args={[1.4, 64, 64]} />
        <shaderMaterial
          ref={material}
          uniforms={{
            uColor: { value: new THREE.Color(STATE_COLORS.idle) },
            uTime: { value: 0 },
            uIntensity: { value: 1 },
          }}
          vertexShader={VERTEX}
          fragmentShader={FRAGMENT}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          side={THREE.DoubleSide}
        />
      </mesh>
      <mesh ref={wire}>
        <icosahedronGeometry args={[1.5, 2]} />
        <meshBasicMaterial
          color={NEON_CYAN}
          wireframe
          transparent
          opacity={0.15}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      <mesh ref={layer}>
        <icosahedronGeometry args={[1.95, 1]} />
        <meshBasicMaterial
          color={NEON_PURPLE}
          wireframe
          transparent
          opacity={0.08}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

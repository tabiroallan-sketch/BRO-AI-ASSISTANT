'use client';

import * as React from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useReducedMotion } from 'framer-motion';
import { useAiState } from '@/lib/ai-state';
import { audioLevel } from '@/lib/audio-level';
import { STATE_COLORS, STATE_PARAMS } from './sphere-state';

const PARTICLE_COUNT = 6000;

const VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uSpeed;
  uniform float uIntensity;
  uniform float uViewportH;
  uniform float uSound;

  attribute float aRadius;
  attribute float aAzimuth;
  attribute float aElevation;
  attribute float aSpeed;
  attribute float aSize;
  attribute float aPhase;
  attribute float aTwinkle;

  varying float vAlpha;

  void main() {
    float t = uTime * uSpeed;
    float orbit = aAzimuth + t * aSpeed * 0.16;
    float bob = sin(t * 0.9 + aPhase * 2.0) * 0.35;
    float r = aRadius + sin(t * 0.45 + aPhase * 3.0) * 0.5 * uIntensity;
    r += uSound * 0.35;
    bob += uSound * 0.6;

    vec3 p;
    p.x = cos(orbit) * cos(aElevation) * r;
    p.y = sin(aElevation) * r * 0.65 + bob;
    p.z = sin(orbit) * cos(aElevation) * r;

    float glow = 0.45 + 0.55 * sin(t * 1.8 + aPhase * 7.0);
    vAlpha = glow * (0.35 + aTwinkle * 0.65) * uIntensity * (0.6 + uSound * 0.9);

    vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = aSize * (uViewportH / max(-mvPosition.z, 0.1)) * 0.45;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;

  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);
    float a = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(uColor, a * vAlpha);
  }
`;

function buildGeometry(count: number): THREE.BufferGeometry {
  const positions = new Float32Array(count * 3);
  const radius = new Float32Array(count);
  const azimuth = new Float32Array(count);
  const elevation = new Float32Array(count);
  const speed = new Float32Array(count);
  const size = new Float32Array(count);
  const phase = new Float32Array(count);
  const twinkle = new Float32Array(count);

  for (let i = 0; i < count; i += 1) {
    const r = 2.3 + Math.random() * 4.7;
    const az = Math.random() * Math.PI * 2;
    const el = (Math.random() - 0.5) * Math.PI * 0.95;
    radius[i] = r;
    azimuth[i] = az;
    elevation[i] = el;
    speed[i] = 0.4 + Math.random() * 1.6;
    size[i] = 0.03 + Math.random() * 0.07;
    phase[i] = Math.random() * Math.PI * 2;
    twinkle[i] = Math.random();
    positions[i * 3] = Math.cos(az) * Math.cos(el) * r;
    positions[i * 3 + 1] = Math.sin(el) * r;
    positions[i * 3 + 2] = Math.sin(az) * Math.cos(el) * r;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aRadius', new THREE.BufferAttribute(radius, 1));
  geometry.setAttribute('aAzimuth', new THREE.BufferAttribute(azimuth, 1));
  geometry.setAttribute('aElevation', new THREE.BufferAttribute(elevation, 1));
  geometry.setAttribute('aSpeed', new THREE.BufferAttribute(speed, 1));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  geometry.setAttribute('aTwinkle', new THREE.BufferAttribute(twinkle, 1));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 9);
  return geometry;
}

/**
 * GPU-accelerated particle cloud surrounding the core. Thousands of points in
 * a single draw call; every particle orbits, floats, breathes and twinkles in
 * the vertex shader, so nothing is animated on the CPU. Color, speed and
 * intensity follow the AI state, and the cloud reacts to the microphone
 * amplitude written by Milestone 6.
 */
export function ParticleField(): React.JSX.Element {
  const material = React.useRef<THREE.ShaderMaterial>(null);
  const reduceMotion = useReducedMotion();
  const geometry = React.useMemo(() => buildGeometry(PARTICLE_COUNT), []);

  const current = React.useRef({
    speed: STATE_PARAMS.idle.speed * 1.5,
    intensity: STATE_PARAMS.idle.intensity,
    sound: 0,
    color: new THREE.Color(STATE_COLORS.idle),
  });
  const targetColor = React.useRef(new THREE.Color());

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05);
    const ai = useAiState.getState();
    const target = STATE_PARAMS[ai.state];
    targetColor.current.set(STATE_COLORS[ai.state]);

    const cur = current.current;
    cur.speed = THREE.MathUtils.damp(cur.speed, target.speed * 1.5, 1.6, dt);
    cur.intensity = THREE.MathUtils.damp(cur.intensity, target.intensity, 2.2, dt);
    cur.sound = THREE.MathUtils.damp(cur.sound, audioLevel.smoothed, 6, dt);
    cur.color.lerp(targetColor.current, 1 - Math.pow(0.0005, dt));

    const mat = material.current;
    if (!mat) {
      return;
    }
    mat.uniforms.uTime.value = state.clock.elapsedTime;
    mat.uniforms.uSpeed.value = reduceMotion ? 0 : cur.speed;
    mat.uniforms.uIntensity.value = cur.intensity;
    mat.uniforms.uViewportH.value = state.size.height;
    mat.uniforms.uSound.value = cur.sound;
    (mat.uniforms.uColor.value as THREE.Color).copy(cur.color);
  });

  return (
    <points geometry={geometry} frustumCulled={false}>
      <shaderMaterial
        ref={material}
        uniforms={{
          uTime: { value: 0 },
          uSpeed: { value: 0.1 },
          uIntensity: { value: 1 },
          uViewportH: { value: 900 },
          uSound: { value: 0 },
          uColor: { value: new THREE.Color(STATE_COLORS.idle) },
        }}
        vertexShader={VERTEX}
        fragmentShader={FRAGMENT}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

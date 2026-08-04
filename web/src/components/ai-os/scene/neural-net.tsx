'use client';

import * as React from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useReducedMotion } from 'framer-motion';
import { useAiState } from '@/lib/ai-state';
import { audioLevel } from '@/lib/audio-level';
import { STATE_COLORS, STATE_PARAMS } from './sphere-state';

interface LayerDef {
  count: number;
  radius: number;
  tiltX: number;
  tiltZ: number;
}

const LAYERS: LayerDef[] = [
  { count: 10, radius: 3.1, tiltX: 0.7, tiltZ: 0.2 },
  { count: 16, radius: 4.0, tiltX: -0.5, tiltZ: 0.6 },
  { count: 24, radius: 4.9, tiltX: 1.1, tiltZ: -0.4 },
];

const SYNAPSE_VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uSpeed;
  uniform float uIntensity;

  attribute float aT;
  attribute float aOffset;

  varying float vGlow;

  void main() {
    float head = fract(uTime * uSpeed + aOffset);
    float dist = abs(aT - head);
    dist = min(dist, 1.0 - dist);
    float glow = exp(-dist * dist * 300.0);
    vGlow = 0.1 + 0.9 * glow * uIntensity;

    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const SYNAPSE_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  varying float vGlow;

  void main() {
    gl_FragColor = vec4(uColor, vGlow);
  }
`;

const NEURON_VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uSpeed;
  uniform float uIntensity;
  uniform float uViewportH;

  attribute float aPhase;

  varying float vAlpha;

  void main() {
    float w = fract(uTime * uSpeed * 0.5 + aPhase);
    float d = min(w, 1.0 - w);
    float fire = exp(-d * d * 300.0);
    vAlpha = (0.3 + 0.7 * fire) * uIntensity;

    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = 0.11 * (uViewportH / max(-mvPosition.z, 0.1)) * 0.45;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const NEURON_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;

  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);
    float a = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(uColor, a * vAlpha);
  }
`;

function rotate(pos: THREE.Vector3, tiltX: number, tiltZ: number): THREE.Vector3 {
  const p = pos.clone();
  const cosX = Math.cos(tiltX);
  const sinX = Math.sin(tiltX);
  const y1 = p.y * cosX - p.z * sinX;
  const z1 = p.y * sinX + p.z * cosX;
  p.y = y1;
  p.z = z1;
  const cosZ = Math.cos(tiltZ);
  const sinZ = Math.sin(tiltZ);
  const x2 = p.x * cosZ - p.y * sinZ;
  const y2 = p.x * sinZ + p.y * cosZ;
  p.x = x2;
  p.y = y2;
  return p;
}

interface NetworkGeometry {
  nodes: Float32Array;
  nodePhases: Float32Array;
  synapses: Float32Array;
  synapseT: Float32Array;
  synapseOffsets: Float32Array;
}

function buildNetwork(): NetworkGeometry {
  const positions: THREE.Vector3[] = [];
  const perLayer: THREE.Vector3[][] = [];

  LAYERS.forEach((layer, li) => {
    const ring: THREE.Vector3[] = [];
    const offset = (li % 2) * 0.15;
    for (let i = 0; i < layer.count; i += 1) {
      const angle = (i / layer.count) * Math.PI * 2 + offset;
      const base = new THREE.Vector3(
        Math.cos(angle) * layer.radius,
        0,
        Math.sin(angle) * layer.radius,
      );
      const p = rotate(base, layer.tiltX, layer.tiltZ);
      ring.push(p);
      positions.push(p);
    }
    perLayer.push(ring);
  });

  const synapses: number[] = [];
  const synapseT: number[] = [];
  const synapseOffsets: number[] = [];
  const addEdge = (a: THREE.Vector3, b: THREE.Vector3): void => {
    const offset = Math.random();
    synapses.push(a.x, a.y, a.z, b.x, b.y, b.z);
    synapseT.push(0, 1);
    synapseOffsets.push(offset, offset);
  };

  perLayer.forEach((ring, li) => {
    for (let i = 0; i < ring.length; i += 1) {
      addEdge(ring[i], ring[(i + 1) % ring.length]);
    }
    const next = perLayer[li + 1];
    if (next) {
      for (const node of ring) {
        let nearest = next[0];
        let best = Number.POSITIVE_INFINITY;
        for (const cand of next) {
          const d = node.distanceToSquared(cand);
          if (d < best) {
            best = d;
            nearest = cand;
          }
        }
        addEdge(node, nearest);
      }
    }
  });

  return {
    nodes: new Float32Array(positions.flatMap((p) => [p.x, p.y, p.z])),
    nodePhases: new Float32Array(positions.map(() => Math.random())),
    synapses: new Float32Array(synapses),
    synapseT: new Float32Array(synapseT),
    synapseOffsets: new Float32Array(synapseOffsets),
  };
}

/**
 * Layered neural network wrapped around the core: three tilted rings of
 * neurons connected by synapses. Energy pulses travel along the synapses and
 * neurons fire as waves pass — speed and brightness follow the AI state, so
 * the network visibly "thinks" during processing and calms down when idle.
 * All animation runs on the GPU.
 */
export function NeuralNet(): React.JSX.Element {
  const reduceMotion = useReducedMotion();
  const geometry = React.useMemo(() => buildNetwork(), []);
  const synapseMaterial = React.useRef<THREE.ShaderMaterial>(null);
  const neuronMaterial = React.useRef<THREE.ShaderMaterial>(null);

  const current = React.useRef({
    speed: STATE_PARAMS.idle.speed,
    intensity: STATE_PARAMS.idle.intensity,
    sound: 0,
    color: new THREE.Color(STATE_COLORS.idle),
  });
  const targetColor = React.useRef(new THREE.Color());

  const synapseGeometry = React.useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(geometry.synapses, 3));
    g.setAttribute('aT', new THREE.BufferAttribute(geometry.synapseT, 1));
    g.setAttribute('aOffset', new THREE.BufferAttribute(geometry.synapseOffsets, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 7);
    return g;
  }, [geometry]);

  const neuronGeometry = React.useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(geometry.nodes, 3));
    g.setAttribute('aPhase', new THREE.BufferAttribute(geometry.nodePhases, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 7);
    return g;
  }, [geometry]);

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05);
    const ai = useAiState.getState();
    const target = STATE_PARAMS[ai.state];
    targetColor.current.set(STATE_COLORS[ai.state]);

    const cur = current.current;
    cur.speed = THREE.MathUtils.damp(cur.speed, target.speed, 2, dt);
    cur.intensity = THREE.MathUtils.damp(cur.intensity, target.intensity, 2.2, dt);
    cur.sound = THREE.MathUtils.damp(cur.sound, audioLevel.smoothed, 6, dt);
    cur.color.lerp(targetColor.current, 1 - Math.pow(0.0005, dt));

    const motion = reduceMotion ? 0 : 1;
    const syn = synapseMaterial.current;
    const neu = neuronMaterial.current;
    if (!syn || !neu) {
      return;
    }
    const time = state.clock.elapsedTime;
    const speed = cur.speed * (1 + cur.sound * 1.5);
    syn.uniforms.uTime.value = time;
    syn.uniforms.uSpeed.value = motion * speed;
    syn.uniforms.uIntensity.value = cur.intensity;
    (syn.uniforms.uColor.value as THREE.Color).copy(cur.color);
    neu.uniforms.uTime.value = time;
    neu.uniforms.uSpeed.value = motion * speed;
    neu.uniforms.uIntensity.value = cur.intensity;
    neu.uniforms.uViewportH.value = state.size.height;
    (neu.uniforms.uColor.value as THREE.Color).copy(cur.color);
  });

  return (
    <group>
      <lineSegments geometry={synapseGeometry} frustumCulled={false}>
        <shaderMaterial
          ref={synapseMaterial}
          uniforms={{
            uTime: { value: 0 },
            uSpeed: { value: 0.1 },
            uIntensity: { value: 1 },
            uColor: { value: new THREE.Color(STATE_COLORS.idle) },
          }}
          vertexShader={SYNAPSE_VERTEX}
          fragmentShader={SYNAPSE_FRAGMENT}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </lineSegments>
      <points geometry={neuronGeometry} frustumCulled={false}>
        <shaderMaterial
          ref={neuronMaterial}
          uniforms={{
            uTime: { value: 0 },
            uSpeed: { value: 0.1 },
            uIntensity: { value: 1 },
            uViewportH: { value: 900 },
            uColor: { value: new THREE.Color(STATE_COLORS.idle) },
          }}
          vertexShader={NEURON_VERTEX}
          fragmentShader={NEURON_FRAGMENT}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>
    </group>
  );
}

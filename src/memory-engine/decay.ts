import { MEMORY_DECAY_HALF_LIFE_DAYS } from './types.js';
import type { MemoryMeta } from './types.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function validTime(date: Date): number | undefined {
  const time = date.getTime();
  return Number.isNaN(time) ? undefined : time;
}

/** The most recent signal that a memory was used: last access, update or creation. */
export function memoryLastSeen(meta: MemoryMeta, fallback: Date): Date {
  if (meta.lastAccessedAt) {
    const time = validTime(new Date(meta.lastAccessedAt));
    if (time !== undefined) {
      return new Date(time);
    }
  }
  const fallbackTime = validTime(fallback);
  return fallbackTime !== undefined ? new Date(fallbackTime) : new Date(0);
}

/**
 * Vitality score for a memory: its importance dampened by how long it has been
 * since it was last seen. Fresh, important memories score highest; old and
 * rarely-recalled memories decay toward zero. Range (0, importance].
 */
export function decayScore(meta: MemoryMeta, now: Date, fallback: Date): number {
  const last = memoryLastSeen(meta, fallback).getTime();
  const days = Math.max(0, (now.getTime() - last) / DAY_MS);
  return meta.importance * Math.pow(0.5, days / MEMORY_DECAY_HALF_LIFE_DAYS);
}

/** Relative strength 0..1: how much of its importance a memory still carries. */
export function memoryStrength(meta: MemoryMeta, now: Date, fallback: Date): number {
  return Math.max(0, Math.min(1, decayScore(meta, now, fallback) / meta.importance));
}

/** Days since a memory was last seen (used by the timeline viewer). */
export function daysSinceLastSeen(meta: MemoryMeta, now: Date, fallback: Date): number {
  return Math.max(
    0,
    Math.floor((now.getTime() - memoryLastSeen(meta, fallback).getTime()) / DAY_MS),
  );
}

/** Marks a memory as recalled right now: refreshes freshness and counts accesses. */
export function reinforce(meta: MemoryMeta, now: Date): MemoryMeta {
  return {
    ...meta,
    lastAccessedAt: now.toISOString(),
    accessCount: meta.accessCount + 1,
  };
}

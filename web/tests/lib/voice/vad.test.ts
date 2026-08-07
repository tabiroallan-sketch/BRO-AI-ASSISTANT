import { describe, expect, it, vi } from 'vitest';
import { createVad } from '@/lib/voice/vad';

function makeClock(): { now: () => number; tick: () => void } {
  let now = 0;
  return {
    now: () => now,
    tick: () => {
      now += 1;
    },
  };
}

function makeVad(overrides: { minSpeechMs?: number; maxSpeechMs?: number } = {}) {
  const clock = makeClock();
  const onSpeechStart = vi.fn();
  const onSpeechEnd = vi.fn();
  const vad = createVad({
    onSpeechStart,
    onSpeechEnd,
    threshold: 0.05,
    startFrames: 3,
    endFrames: 8,
    minSpeechMs: overrides.minSpeechMs ?? 300,
    maxSpeechMs: overrides.maxSpeechMs ?? 15_000,
    now: clock.now,
  });
  const feed = (level: number): void => {
    clock.tick();
    vad.feed(level);
  };
  return { vad, feed, onSpeechStart, onSpeechEnd };
}

describe('createVad', () => {
  it('starts speech after enough consecutive above-threshold frames', () => {
    const { vad, feed, onSpeechStart } = makeVad();
    feed(0);
    feed(0);
    feed(0.1);
    feed(0.1);
    expect(onSpeechStart).not.toHaveBeenCalled();
    expect(vad.isActive()).toBe(false);
    feed(0.1);
    expect(onSpeechStart).toHaveBeenCalledOnce();
    expect(vad.isActive()).toBe(true);
  });

  it('requires consecutive above-threshold frames to start', () => {
    const { vad, feed, onSpeechStart } = makeVad();
    feed(0.1);
    feed(0.1);
    feed(0);
    feed(0.1);
    feed(0.1);
    expect(onSpeechStart).not.toHaveBeenCalled();
    feed(0.1);
    expect(onSpeechStart).toHaveBeenCalledOnce();
    expect(vad.isActive()).toBe(true);
  });

  it('ends speech after the hangover window', () => {
    const { feed, onSpeechEnd } = makeVad({ minSpeechMs: 300 });
    for (let i = 0; i < 3; i += 1) {
      feed(0.1);
    }
    for (let i = 0; i < 300; i += 1) {
      feed(0.1);
    }
    expect(onSpeechEnd).not.toHaveBeenCalled();
    for (let i = 0; i < 8; i += 1) {
      feed(0);
    }
    expect(onSpeechEnd).toHaveBeenCalledOnce();
  });

  it('drops utterances shorter than minSpeechMs as noise', () => {
    const { vad, feed, onSpeechEnd } = makeVad({ minSpeechMs: 300 });
    for (let i = 0; i < 3; i += 1) {
      feed(0.1);
    }
    for (let i = 0; i < 8; i += 1) {
      feed(0);
    }
    expect(onSpeechEnd).not.toHaveBeenCalled();
    expect(vad.isActive()).toBe(false);
  });

  it('force-releases a long utterance at maxSpeechMs', () => {
    const { vad, feed, onSpeechEnd } = makeVad({ minSpeechMs: 100, maxSpeechMs: 1000 });
    for (let i = 0; i < 3; i += 1) {
      feed(0.1);
    }
    for (let i = 0; i < 1000; i += 1) {
      feed(0.1);
    }
    expect(onSpeechEnd).toHaveBeenCalledOnce();
    expect(vad.isActive()).toBe(false);
  });

  it('reset clears the active state without emitting', () => {
    const { vad, feed, onSpeechEnd } = makeVad();
    for (let i = 0; i < 3; i += 1) {
      feed(0.1);
    }
    expect(vad.isActive()).toBe(true);
    vad.reset();
    expect(vad.isActive()).toBe(false);
    for (let i = 0; i < 8; i += 1) {
      feed(0);
    }
    expect(onSpeechEnd).not.toHaveBeenCalled();
  });
});

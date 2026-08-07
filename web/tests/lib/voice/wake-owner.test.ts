import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWakeOwner, decideWakeOwner } from '@/lib/voice/wake-owner';

class FakeChannel {
  static instances: FakeChannel[] = [];
  onmessage: ((event: { data: { ts: number } }) => void) | null = null;
  closed = false;

  constructor(_name: string) {
    FakeChannel.instances.push(this);
  }

  postMessage(message: { ts: number }): void {
    for (const peer of FakeChannel.instances) {
      if (peer !== this && !peer.closed && peer.onmessage) {
        peer.onmessage({ data: { ts: message.ts } });
      }
    }
  }

  close(): void {
    this.closed = true;
  }

  static reset(): void {
    FakeChannel.instances = [];
  }
}

describe('decideWakeOwner', () => {
  it('a window with no heartbeat is not the owner', () => {
    expect(decideWakeOwner(1000, -1, 0, 3000)).toBe(false);
  });

  it('the window with the newest heartbeat owns', () => {
    expect(decideWakeOwner(1000, 500, 400, 3000)).toBe(true);
    expect(decideWakeOwner(1000, 400, 500, 3000)).toBe(false);
  });

  it('claims ownership when the peer heartbeat is stale', () => {
    expect(decideWakeOwner(10000, 9000, 2000, 3000)).toBe(true);
  });
});

describe('createWakeOwner', () => {
  let nowMs = 100_000;

  beforeEach(() => {
    nowMs = 100_000;
    FakeChannel.reset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('a lone window becomes the owner', () => {
    const owner = createWakeOwner({
      broadcastChannel: FakeChannel as unknown as typeof BroadcastChannel,
      now: () => nowMs,
    });
    const changes: boolean[] = [];
    owner.start();
    owner.onOwnership((isOwner) => changes.push(isOwner));
    expect(owner.isOwner()).toBe(true);
    expect(changes).toEqual([true]);
    owner.stop();
  });

  it('relinquishes when a fresher peer heartbeat arrives', () => {
    const owner = createWakeOwner({
      broadcastChannel: FakeChannel as unknown as typeof BroadcastChannel,
      now: () => nowMs,
    });
    owner.start();
    expect(owner.isOwner()).toBe(true);

    // A peer heartbeats with a newer timestamp.
    const channel = FakeChannel.instances[0];
    channel.onmessage?.({ data: { ts: nowMs + 5000 } });
    expect(owner.isOwner()).toBe(false);

    // Our next heartbeat is newer again, so we reclaim.
    nowMs += 10_000;
    owner.start(); // re-post
    vi.advanceTimersByTime(1_000);
    expect(owner.isOwner()).toBe(true);
    owner.stop();
  });

  it('a window that never sent a heartbeat is not the owner', () => {
    const owner = createWakeOwner({
      broadcastChannel: FakeChannel as unknown as typeof BroadcastChannel,
      now: () => nowMs,
    });
    expect(owner.isOwner()).toBe(false);
    owner.stop();
  });
});

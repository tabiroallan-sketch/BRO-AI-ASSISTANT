/**
 * Wake-word ownership (Stage 6): the wake engine must run in exactly one
 * window at a time (the overlay and the dashboard are separate BrowserWindows
 * sharing the same origin). This helper runs a tiny leader-election over
 * BroadcastChannel — the window that last sent a heartbeat owns the wake word;
 * stale peers yield to the newest claimer. Pure decision logic is exported
 * for unit tests; the channel wiring is isolated behind the constructor.
 */

export type WakeOwnerDeps = {
  broadcastChannel?: typeof BroadcastChannel;
  now?: () => number;
  /** Heartbeat cadence (default 1000ms). */
  heartbeatMs?: number;
  /** A peer is stale after this much silence (default 3000ms). */
  timeoutMs?: number;
};

type WakeChannel = {
  postMessage(message: unknown): void;
  onmessage: ((event: { data: { ts?: number } }) => void) | null;
  close(): void;
};

export type WakeOwner = {
  start: () => void;
  stop: () => void;
  isOwner: () => boolean;
  /** Fires whenever ownership changes (true = this window owns the wake word). */
  onOwnership: (callback: (owner: boolean) => void) => () => void;
};

const CHANNEL = 'bro.wake-owner.v1';
const DEFAULT_HEARTBEAT_MS = 1_000;
const DEFAULT_TIMEOUT_MS = 3_000;

/**
 * Pure ownership decision from heartbeat timestamps. A window owns the wake
 * word when its own latest heartbeat is at least as new as the newest peer's
 * — or when every peer's heartbeat has gone stale.
 */
export function decideWakeOwner(
  nowTs: number,
  lastSent: number,
  lastReceived: number,
  timeoutMs: number,
): boolean {
  if (lastSent < 0) {
    return false;
  }
  if (lastReceived > lastSent) {
    return false;
  }
  return nowTs - lastReceived > timeoutMs || lastSent >= lastReceived;
}

export function createWakeOwner(deps: WakeOwnerDeps = {}): WakeOwner {
  const heartbeatMs = deps.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const now = deps.now ?? (() => Date.now());
  const Channel =
    deps.broadcastChannel ?? (typeof BroadcastChannel !== 'undefined' ? BroadcastChannel : null);

  let channel: WakeChannel | null = null;
  let lastSent = -1;
  let lastReceived = -1;
  let interval: ReturnType<typeof setInterval> | null = null;
  const listeners = new Set<(owner: boolean) => void>();
  let lastNotified: boolean | null = null;

  const owner = (): boolean => decideWakeOwner(now(), lastSent, lastReceived, timeoutMs);

  function notify(): void {
    const current = owner();
    if (current === lastNotified) {
      return;
    }
    lastNotified = current;
    for (const listener of listeners) {
      listener(current);
    }
  }

  function heartbeat(): void {
    lastSent = now();
    try {
      channel?.postMessage({ ts: lastSent } as never);
    } catch {
      // Channel closed mid-tick.
    }
    notify();
  }

  return {
    start: () => {
      if (interval || !Channel) {
        if (!interval && !Channel) {
          // No BroadcastChannel: a lone window is always the owner.
          lastSent = now();
          notify();
        }
        return;
      }
      channel = new Channel(CHANNEL) as unknown as WakeChannel;
      channel.onmessage = (event) => {
        const ts = event.data?.ts;
        if (typeof ts === 'number' && ts > lastReceived) {
          lastReceived = ts;
          notify();
        }
      };
      interval = setInterval(heartbeat, heartbeatMs);
      heartbeat();
    },
    stop: () => {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
      if (channel) {
        try {
          channel.close();
        } catch {
          // Already closed.
        }
        channel = null;
      }
      lastReceived = 0;
      lastNotified = null;
    },
    isOwner: () => owner(),
    onOwnership: (callback) => {
      listeners.add(callback);
      const current = owner();
      if (lastNotified === null) {
        lastNotified = current;
      }
      callback(current);
      return () => {
        listeners.delete(callback);
      };
    },
  };
}

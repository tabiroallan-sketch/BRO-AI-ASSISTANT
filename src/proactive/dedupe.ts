export interface DedupeStore {
  /**
   * Returns true when the key was already recorded in a previous sweep. Used
   * for one-shot items (an email message, calendar event, GitHub issue) that
   * should only ever generate a single notification.
   */
  rememberOnce(userId: string, key: string, now: Date): boolean;
  /**
   * Returns true when the key was recorded within the cooldown window. Used
   * for stateful conditions (build failing, low disk, high CPU) that should
   * re-alert after the cooldown has elapsed. The current timestamp is
   * recorded when the cooldown has expired.
   */
  inCooldown(userId: string, key: string, cooldownMs: number, now: Date): boolean;
  /** Drops entries older than maxAgeMs. */
  prune(maxAgeMs: number, now: Date): void;
  clear(): void;
}

export function createDedupeStore(): DedupeStore {
  const once = new Map<string, number>();
  const cooldown = new Map<string, number>();

  const onceKey = (userId: string, key: string): string => `${userId}:once:${key}`;
  const cooldownKey = (userId: string, key: string): string => `${userId}:cooldown:${key}`;

  return {
    rememberOnce(userId: string, key: string, now: Date): boolean {
      const storeKey = onceKey(userId, key);
      if (once.has(storeKey)) {
        return true;
      }
      once.set(storeKey, now.getTime());
      return false;
    },
    inCooldown(userId: string, key: string, cooldownMs: number, now: Date): boolean {
      const storeKey = cooldownKey(userId, key);
      const last = cooldown.get(storeKey);
      if (last !== undefined && now.getTime() - last < cooldownMs) {
        return true;
      }
      cooldown.set(storeKey, now.getTime());
      return false;
    },
    prune(maxAgeMs: number, now: Date): void {
      const cutoff = now.getTime() - maxAgeMs;
      for (const [key, timestamp] of once) {
        if (timestamp < cutoff) {
          once.delete(key);
        }
      }
      for (const [key, timestamp] of cooldown) {
        if (timestamp < cutoff) {
          cooldown.delete(key);
        }
      }
    },
    clear(): void {
      once.clear();
      cooldown.clear();
    },
  };
}

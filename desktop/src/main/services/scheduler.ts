/**
 * Lightweight task scheduler for background work (Stage 2). Tasks run
 * sequentially, never overlapping; an exception in one task never stops the
 * schedule. Intervals can be static or adaptive (a function evaluated each
 * cycle), which the heartbeat uses to throttle itself while the window is
 * hidden. All timers are chained (each run schedules the next only after it
 * finishes), so idle CPU stays near zero.
 */

export type ScheduledTask = {
  /** Stable identifier, used for logging and tests. */
  id: string;
  /** Work to perform each cycle. */
  run: () => Promise<void> | void;
  /**
   * Delay between runs in milliseconds. A function is evaluated per cycle,
   * allowing the interval to adapt to runtime conditions (e.g. background
   * mode) without re-registering the task.
   */
  intervalMs: number | (() => number);
  /** Fraction of the interval added as random jitter to spread task timing. */
  jitter?: number;
  /** Do not keep the process alive solely for this task. */
  unref?: boolean;
};

export type BackgroundSchedulerOptions = {
  onError?: (taskId: string, error: unknown) => void;
  onRun?: (taskId: string) => void;
};

type TaskState = {
  task: ScheduledTask;
  timer: ReturnType<typeof setTimeout> | null;
  running: boolean;
  runCount: number;
};

export class BackgroundScheduler {
  private readonly tasks = new Map<string, TaskState>();
  private readonly options: BackgroundSchedulerOptions;
  private started = false;

  constructor(options: BackgroundSchedulerOptions = {}) {
    this.options = options;
  }

  /** Registers a task. Returns an unregister function. */
  register(task: ScheduledTask): () => void {
    const state: TaskState = { task, timer: null, running: false, runCount: 0 };
    this.tasks.set(task.id, state);
    if (this.started) {
      // Already started: run once immediately, then on the schedule. The
      // heartbeat relies on this so services are verified right away.
      void this.fire(state);
    }
    return () => {
      this.unregister(task.id);
    };
  }

  unregister(id: string): void {
    const state = this.tasks.get(id);
    if (!state) {
      return;
    }
    if (state.timer) {
      clearTimeout(state.timer);
    }
    this.tasks.delete(id);
  }

  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    for (const state of this.tasks.values()) {
      // Run each task immediately once, then let the interval take over.
      void this.fire(state);
    }
  }

  stop(): void {
    this.started = false;
    for (const state of this.tasks.values()) {
      if (state.timer) {
        clearTimeout(state.timer);
        state.timer = null;
      }
    }
  }

  /** Number of registered tasks (useful for tests/telemetry). */
  get size(): number {
    return this.tasks.size;
  }

  has(id: string): boolean {
    return this.tasks.has(id);
  }

  runCount(id: string): number {
    return this.tasks.get(id)?.runCount ?? 0;
  }

  private scheduleNext(state: TaskState): void {
    if (!this.started) {
      return;
    }
    const { task } = state;
    let delay = typeof task.intervalMs === 'function' ? task.intervalMs() : task.intervalMs;
    if (task.jitter && task.jitter > 0) {
      delay += delay * task.jitter * Math.random();
    }
    state.timer = setTimeout(() => {
      void this.fire(state);
    }, delay);
    if (task.unref && typeof state.timer === 'object' && 'unref' in state.timer) {
      state.timer.unref();
    }
  }

  private async fire(state: TaskState): Promise<void> {
    if (!this.started || state.running) {
      // A cycle is dropped when the previous run has not finished, keeping
      // task execution strictly sequential.
      return;
    }
    state.running = true;
    try {
      this.options.onRun?.(state.task.id);
      await state.task.run();
      state.runCount += 1;
    } catch (error) {
      this.options.onError?.(state.task.id, error);
    } finally {
      state.running = false;
      this.scheduleNext(state);
    }
  }
}

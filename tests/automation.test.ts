import { describe, expect, it } from 'vitest';
import {
  createAutomationEngine,
  DEFAULT_MAX_RETRIES,
  DEFAULT_RETRY_DELAY_MS,
} from '../src/automation/engine.js';
import { createEventBus } from '../src/automation/events.js';
import { createToolExecutor } from '../src/automation/executor.js';
import {
  createFallbackPlanner,
  createHeuristicPlanner,
  createLLMPlanner,
} from '../src/automation/planner.js';
import { createTaskQueue } from '../src/automation/queue.js';
import { createAutomationStore } from '../src/automation/store.js';
import type { AutomationEngineDeps } from '../src/automation/engine.js';
import type {
  AutomationStore,
  EventBus,
  PlannedStep,
  StepExecutionResult,
  TaskQueue,
} from '../src/automation/types.js';

function options(): Required<{
  maxRetries: number;
  continueOnError: boolean;
  notifyOnCompletion: boolean;
}> {
  return {
    maxRetries: 0,
    continueOnError: false,
    notifyOnCompletion: true,
  };
}

describe('store', () => {
  it('creates tasks and lists them newest-first per user', () => {
    const store = createAutomationStore();
    const a = store.createTask({ userId: 'u1', title: 'A', goal: 'g', options: options() });
    const b = store.createTask({ userId: 'u1', title: 'B', goal: 'g', options: options() });
    store.createTask({ userId: 'u2', title: 'C', goal: 'g', options: options() });

    expect(store.listTasksForUser('u1').map((task) => task.id)).toEqual([b.id, a.id]);
    expect(store.listTasksForUser('u2')).toHaveLength(1);
  });

  it('honours the status filter', () => {
    const store = createAutomationStore();
    const a = store.createTask({ userId: 'u1', title: 'A', goal: 'g', options: options() });
    store.updateTask(a.id, { status: 'completed' });
    const b = store.createTask({ userId: 'u1', title: 'B', goal: 'g', options: options() });

    expect(store.listTasksForUser('u1', { status: 'completed' }).map((task) => task.id)).toEqual([
      a.id,
    ]);
    expect(store.listTasksForUser('u1', { status: 'queued' }).map((task) => task.id)).toEqual([
      b.id,
    ]);
  });

  it('evicts terminal tasks beyond the per-user cap', () => {
    const store = createAutomationStore({ maxTasksPerUser: 2 });
    const a = store.createTask({ userId: 'u1', title: 'A', goal: 'g', options: options() });
    const b = store.createTask({ userId: 'u1', title: 'B', goal: 'g', options: options() });
    const c = store.createTask({ userId: 'u1', title: 'C', goal: 'g', options: options() });

    expect(store.listTasksForUser('u1')).toHaveLength(3);
    store.updateTask(a.id, { status: 'failed' });
    const d = store.createTask({ userId: 'u1', title: 'D', goal: 'g', options: options() });
    expect(store.getTask(a.id)).toBeUndefined();
    expect(store.getTask(b.id)).toBeDefined();
    expect(store.getTask(c.id)).toBeDefined();
    expect(store.getTask(d.id)).toBeDefined();
  });
});

describe('queue', () => {
  it('runs at most `concurrency` runnables at once, FIFO order', async () => {
    const queue = createTaskQueue({ concurrency: 1 });
    const log: string[] = [];
    const runnable = (name: string, ms: number) => (): Promise<void> =>
      new Promise((resolve) => {
        setTimeout(() => {
          log.push(name);
          resolve();
        }, ms);
      });

    queue.enqueue(runnable('a', 10));
    queue.enqueue(runnable('b', 1));
    expect(queue.running).toBe(1);
    expect(queue.pending).toBe(1);

    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(log).toEqual(['a', 'b']);
    expect(queue.size).toBe(0);
    expect(queue.running).toBe(0);
  });

  it('cancels a queued runnable before it starts', async () => {
    const queue = createTaskQueue({ concurrency: 1 });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ran: string[] = [];

    queue.enqueue(() => gate);
    const second = queue.enqueue(() => {
      ran.push('second');
      return Promise.resolve();
    });

    expect(queue.cancel(second)).toBe(true);
    expect(queue.cancel('missing')).toBe(false);
    release();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(ran).toEqual([]);
    expect(queue.size).toBe(0);
  });
});

describe('heuristic planner', () => {
  const tools = [
    {
      name: 'system_launch_app',
      description: 'Launch an application',
      parameters: { type: 'object' as const, properties: {} },
      execute: (): string => '',
    },
    {
      name: 'system_search_files',
      description: 'Search files',
      parameters: { type: 'object' as const, properties: {} },
      execute: (): string => '',
    },
    {
      name: 'weather',
      description: 'Weather',
      parameters: { type: 'object' as const, properties: {} },
      execute: (): string => '',
    },
    {
      name: 'current_time',
      description: 'Time',
      parameters: { type: 'object' as const, properties: {} },
      execute: (): string => '',
    },
    {
      name: 'system_run_command',
      description: 'Run a command',
      parameters: { type: 'object' as const, properties: {} },
      execute: (): string => '',
    },
  ];
  const planner = createHeuristicPlanner({ getTools: () => tools });

  it('plans a launch goal', async () => {
    const steps = await planner.plan({ goal: 'launch Chrome' });
    expect(steps).toHaveLength(1);
    expect(steps[0].toolName).toBe('system_launch_app');
    expect(steps[0].args).toEqual({ name: 'chrome' });
  });

  it('plans a file search goal', async () => {
    const steps = await planner.plan({ goal: 'find the tax report file' });
    expect(steps[0].toolName).toBe('system_search_files');
  });

  it('plans a command goal', async () => {
    const steps = await planner.plan({ goal: 'run npm test' });
    expect(steps[0].toolName).toBe('system_run_command');
    expect(steps[0].args.command).toContain('npm test');
  });

  it('plans a weather goal', async () => {
    const steps = await planner.plan({ goal: 'what is the weather?' });
    expect(steps[0].toolName).toBe('weather');
  });

  it('plans a time goal', async () => {
    const steps = await planner.plan({ goal: 'what time is it?' });
    expect(steps[0].toolName).toBe('current_time');
  });

  it('returns an empty plan when nothing matches', async () => {
    expect(await planner.plan({ goal: 'think about the meaning of life' })).toEqual([]);
  });

  it('skips recipes whose tool is not registered', async () => {
    const empty = createHeuristicPlanner({ getTools: () => [] });
    expect(await empty.plan({ goal: 'launch Chrome' })).toEqual([]);
  });
});

describe('LLM planner', () => {
  const tools = [
    {
      name: 'weather',
      description: 'Get the weather',
      parameters: { type: 'object' as const, properties: {} },
      execute: (): string => '',
    },
  ];

  it('parses a JSON plan', async () => {
    const planner = createLLMPlanner({
      getTools: () => tools,
      runCompletion: async () => ({
        content:
          '{"steps":[{"toolName":"weather","args":{"location":"Paris"},"description":"Weather in Paris"}]}',
      }),
    });
    const steps = await planner.plan({ goal: 'weather in paris' });
    expect(steps).toEqual([
      { toolName: 'weather', args: { location: 'Paris' }, description: 'Weather in Paris' },
    ]);
  });

  it('strips markdown fences', async () => {
    const planner = createLLMPlanner({
      getTools: () => tools,
      runCompletion: async () => ({
        content: '```json\n{"steps":[{"toolName":"weather","args":{},"description":"x"}]}\n```',
      }),
    });
    const steps = await planner.plan({ goal: 'weather' });
    expect(steps).toHaveLength(1);
  });

  it('returns an empty plan for invalid output', async () => {
    const planner = createLLMPlanner({
      getTools: () => tools,
      runCompletion: async () => ({ content: 'sorry, no plan' }),
    });
    expect(await planner.plan({ goal: 'weather' })).toEqual([]);
  });

  it('drops tools that are not in the registry', async () => {
    const planner = createLLMPlanner({
      getTools: () => tools,
      runCompletion: async () => ({
        content:
          '{"steps":[{"toolName":"nope","args":{},"description":"x"},{"toolName":"weather","args":{},"description":"y"}]}',
      }),
    });
    const steps = await planner.plan({ goal: 'weather' });
    expect(steps).toHaveLength(1);
    expect(steps[0].toolName).toBe('weather');
  });
});

describe('fallback planner', () => {
  const tools = [
    {
      name: 'system_launch_app',
      description: 'Launch an application',
      parameters: { type: 'object' as const, properties: {} },
      execute: (): string => '',
    },
  ];

  it('uses the LLM plan when available', async () => {
    const planner = createFallbackPlanner({
      getTools: () => tools,
      runCompletion: async () => ({
        content:
          '{"steps":[{"toolName":"system_launch_app","args":{"name":"Code"},"description":"x"}]}',
      }),
    });
    const steps = await planner.plan({ goal: 'launch Chrome' });
    expect(steps[0].args).toEqual({ name: 'Code' });
  });

  it('falls back to the heuristic planner when the LLM throws', async () => {
    const planner = createFallbackPlanner({
      getTools: () => tools,
      runCompletion: async () => {
        throw new Error('not configured');
      },
    });
    const steps = await planner.plan({ goal: 'launch Chrome' });
    expect(steps[0].toolName).toBe('system_launch_app');
    expect(steps[0].args).toEqual({ name: 'chrome' });
  });

  it('falls back when the LLM returns no usable steps', async () => {
    const planner = createFallbackPlanner({
      getTools: () => tools,
      runCompletion: async () => ({ content: '{"steps":[]}' }),
    });
    const steps = await planner.plan({ goal: 'launch Chrome' });
    expect(steps[0].toolName).toBe('system_launch_app');
  });
});

describe('executor', () => {
  it('runs a tool and validates its output', async () => {
    const executor = createToolExecutor({
      getTool: () => ({
        name: 'echo',
        description: '',
        parameters: { type: 'object' as const, properties: {} },
        execute: async (args) => `echo:${String(args.text ?? '')}`,
      }),
      validateOutput: (input) => String(input),
      describeAction: (toolName) => toolName,
    });
    const result = await executor.runStepOnce(
      { toolName: 'echo', args: { text: 'hi' }, description: '' },
      { userId: 'u1' },
    );
    expect(result).toEqual({ needsConfirmation: false, ok: true, output: 'echo:hi' });
  });

  it('reports an unknown tool as a failure', async () => {
    const executor = createToolExecutor({
      getTool: () => undefined,
      validateOutput: (input) => String(input),
      describeAction: (toolName) => toolName,
    });
    const result = await executor.runStepOnce(
      { toolName: 'ghost', args: {}, description: '' },
      { userId: 'u1' },
    );
    expect(result.needsConfirmation).toBe(false);
    if (!result.needsConfirmation) {
      expect(result.ok).toBe(false);
      expect(result.output).toContain('unknown tool');
    }
  });

  it('surfaces a confirmation request without executing the tool', async () => {
    let executed = false;
    const executor = createToolExecutor({
      getTool: () => ({
        name: 'danger',
        description: '',
        requireConfirmation: true,
        parameters: { type: 'object' as const, properties: {} },
        execute: () => {
          executed = true;
          return 'ran';
        },
      }),
      validateOutput: (input) => String(input),
      describeAction: (toolName, args) => `${toolName}:${JSON.stringify(args)}`,
    });
    const result = await executor.runStepOnce(
      { toolName: 'danger', args: { a: 1 }, description: '' },
      { userId: 'u1' },
    );
    expect(executed).toBe(false);
    expect(result).toEqual({ needsConfirmation: true, summary: 'danger:{"a":1}' });
  });

  it('catches tool errors into a failure result', async () => {
    const executor = createToolExecutor({
      getTool: () => ({
        name: 'boom',
        description: '',
        parameters: { type: 'object' as const, properties: {} },
        execute: () => {
          throw new Error('kaboom');
        },
      }),
      validateOutput: (input) => String(input),
      describeAction: (toolName) => toolName,
    });
    const result = await executor.runStepOnce(
      { toolName: 'boom', args: {}, description: '' },
      { userId: 'u1' },
    );
    if (!result.needsConfirmation) {
      expect(result.ok).toBe(false);
      expect(result.output).toContain('kaboom');
    }
  });
});

type Harness = {
  engine: ReturnType<typeof createAutomationEngine>;
  store: AutomationStore;
  queue: TaskQueue;
  events: EventBus;
  audits: string[];
  pending: Array<{
    userId: string;
    toolName: string;
    args: Record<string, unknown>;
    summary: string;
    taskId?: string;
    stepId?: string;
  }>;
  executorCalls: string[];
  stepResults: Map<string, StepExecutionResult>;
  sleepCalls: number[];
  release: (toolName: string) => void;
  flush: () => Promise<void>;
};

function makeHarness(
  options: {
    plan?: PlannedStep[] | ((goal: string) => PlannedStep[]);
    results?: Record<string, StepExecutionResult>;
    sequence?: Record<string, StepExecutionResult[]>;
    blocked?: string[];
  } = {},
): Harness {
  const store = createAutomationStore({ maxTasksPerUser: 10 });
  const queue = createTaskQueue({ concurrency: 1 });
  const events = createEventBus();
  const audits: string[] = [];
  const pending: Harness['pending'] = [];
  const stepResults = new Map<string, StepExecutionResult>(Object.entries(options.results ?? {}));
  const sequence = { ...options.sequence };
  const executorCalls: string[] = [];
  const sleepCalls: number[] = [];
  const blockers = new Map<string, { release: () => void }>();

  const executor = {
    async runStepOnce(step: PlannedStep) {
      executorCalls.push(step.toolName);
      if (options.blocked?.includes(step.toolName)) {
        await new Promise<void>((resolve) => {
          blockers.set(step.toolName, { release: resolve });
        });
      }
      const seq = sequence[step.toolName];
      if (seq && seq.length > 0) {
        return seq.shift() as StepExecutionResult;
      }
      return (
        stepResults.get(step.toolName) ?? {
          needsConfirmation: false,
          ok: true,
          output: `${step.toolName}:ok`,
        }
      );
    },
  };

  const planner = {
    async plan(input: { goal: string }): Promise<PlannedStep[]> {
      if (typeof options.plan === 'function') {
        return options.plan(input.goal);
      }
      return options.plan ?? [];
    },
  };

  const deps: AutomationEngineDeps = {
    store,
    queue,
    events,
    executor,
    planner,
    listTools: () => [],
    recordAudit: (event) => {
      audits.push(event.action);
      return { ...event, id: `audit-${audits.length}`, at: '' };
    },
    createPendingAction: (input) => {
      pending.push(input);
      return {
        id: `pa-${input.stepId ?? String(Math.random())}`,
        userId: input.userId,
        toolName: input.toolName,
        args: input.args,
        summary: input.summary,
        createdAt: '',
        expiresAt: '',
        status: 'pending' as const,
        ...(input.taskId ? { taskId: input.taskId } : {}),
        ...(input.stepId ? { stepId: input.stepId } : {}),
      };
    },
    sleep: async (ms) => {
      sleepCalls.push(ms);
    },
  };

  const engine = createAutomationEngine(deps);

  return {
    engine,
    store,
    queue,
    events,
    audits,
    pending,
    executorCalls,
    stepResults,
    sleepCalls,
    release: (toolName: string) => {
      blockers.get(toolName)?.release();
    },
    async flush() {
      let guard = 0;
      while (queue.size > 0 || queue.running > 0) {
        if (guard++ > 500) {
          throw new Error('flush timed out');
        }
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
      // Let the last runnable's finally() microtasks settle.
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}

describe('engine', () => {
  it('runs a multi-step plan to completion', async () => {
    const harness = makeHarness({
      plan: () => [
        { toolName: 'stepA', args: {}, description: 'A' },
        { toolName: 'stepB', args: {}, description: 'B' },
      ],
    });
    const task = harness.engine.createTask({ userId: 'u1', title: 'T', goal: 'do both' });
    expect(task.status).toBe('queued');
    await harness.flush();

    const current = harness.engine.getTask(task.id);
    expect(current?.status).toBe('completed');
    expect(current?.steps.map((step) => step.status)).toEqual(['completed', 'completed']);
    expect(current?.steps.map((step) => step.result)).toEqual(['stepA:ok', 'stepB:ok']);
    expect(harness.executorCalls).toEqual(['stepA', 'stepB']);
    expect(harness.audits).toEqual(['automation.task.create', 'automation.task.complete']);
    expect(current?.finishedAt).toBeDefined();
  });

  it('defaults options when none are provided', async () => {
    const harness = makeHarness({ plan: () => [] });
    const task = harness.engine.createTask({ userId: 'u1', title: 'T', goal: 'unplannable' });
    await harness.flush();
    expect(harness.engine.getTask(task.id)?.options).toEqual({
      maxRetries: DEFAULT_MAX_RETRIES,
      continueOnError: false,
      notifyOnCompletion: true,
    });
  });

  it('fails a task when no plan can be derived', async () => {
    const harness = makeHarness({ plan: () => [] });
    const task = harness.engine.createTask({ userId: 'u1', title: 'T', goal: 'unplannable' });
    await harness.flush();
    const current = harness.engine.getTask(task.id);
    expect(current?.status).toBe('failed');
    expect(current?.error).toContain('No plan');
    expect(harness.audits).toContain('automation.task.failed');
  });

  it('retries a failed step up to maxRetries then fails the task', async () => {
    const harness = makeHarness({
      plan: () => [{ toolName: 'flaky', args: {}, description: 'F' }],
      results: { flaky: { needsConfirmation: false, ok: false, output: 'Error: nope' } },
    });
    const task = harness.engine.createTask({
      userId: 'u1',
      title: 'T',
      goal: 'g',
      options: { maxRetries: 2 },
    });
    await harness.flush();
    const current = harness.engine.getTask(task.id);
    expect(current?.status).toBe('failed');
    expect(current?.error).toContain('flaky');
    expect(harness.executorCalls).toEqual(['flaky', 'flaky', 'flaky']);
    expect(harness.sleepCalls.length).toBe(2);
  });

  it('recovers when a later retry succeeds', async () => {
    const harness = makeHarness({
      plan: () => [{ toolName: 'flaky', args: {}, description: 'F' }],
      sequence: {
        flaky: [
          { needsConfirmation: false, ok: false, output: 'Error: 1' },
          { needsConfirmation: false, ok: false, output: 'Error: 2' },
          { needsConfirmation: false, ok: true, output: 'recovered' },
        ],
      },
    });
    const task = harness.engine.createTask({
      userId: 'u1',
      title: 'T',
      goal: 'g',
      options: { maxRetries: 2 },
    });
    await harness.flush();
    const current = harness.engine.getTask(task.id);
    expect(current?.status).toBe('completed');
    expect(current?.steps[0].result).toBe('recovered');
    expect(harness.executorCalls).toHaveLength(3);
  });

  it('honours continueOnError by skipping failed steps', async () => {
    const harness = makeHarness({
      plan: () => [
        { toolName: 'bad', args: {}, description: 'B' },
        { toolName: 'good', args: {}, description: 'G' },
      ],
      results: { bad: { needsConfirmation: false, ok: false, output: 'Error: boom' } },
    });
    const task = harness.engine.createTask({
      userId: 'u1',
      title: 'T',
      goal: 'g',
      options: { continueOnError: true, maxRetries: 0 },
    });
    await harness.flush();
    const current = harness.engine.getTask(task.id);
    expect(current?.status).toBe('completed');
    expect(current?.steps.map((step) => step.status)).toEqual(['failed', 'completed']);
    expect(harness.executorCalls).toEqual(['bad', 'good']);
  });

  it('stops a task at the first failure when continueOnError is off', async () => {
    const harness = makeHarness({
      plan: () => [
        { toolName: 'bad', args: {}, description: 'B' },
        { toolName: 'good', args: {}, description: 'G' },
      ],
      results: { bad: { needsConfirmation: false, ok: false, output: 'Error: boom' } },
    });
    const task = harness.engine.createTask({
      userId: 'u1',
      title: 'T',
      goal: 'g',
      options: { maxRetries: 0 },
    });
    await harness.flush();
    const current = harness.engine.getTask(task.id);
    expect(current?.status).toBe('failed');
    expect(current?.steps.map((step) => step.status)).toEqual(['failed', 'queued']);
    expect(harness.executorCalls).toEqual(['bad']);
  });

  it('pauses at a requireConfirmation step and records the pending action link', async () => {
    const harness = makeHarness({
      plan: () => [
        { toolName: 'safe', args: {}, description: 'S' },
        { toolName: 'danger', args: { path: '/tmp/x' }, description: 'D' },
      ],
      results: { danger: { needsConfirmation: true, summary: 'Delete /tmp/x?' } },
    });
    const task = harness.engine.createTask({ userId: 'u1', title: 'T', goal: 'g' });
    await harness.flush();

    const paused = harness.engine.getTask(task.id);
    expect(paused?.status).toBe('awaiting_confirmation');
    expect(paused?.steps[1].status).toBe('awaiting_confirmation');
    expect(harness.executorCalls).toEqual(['safe', 'danger']);
    expect(harness.pending).toHaveLength(1);
    expect(harness.pending[0].taskId).toBe(task.id);
    expect(harness.pending[0].stepId).toBe(paused?.steps[1].id);
    expect(harness.pending[0].args).toEqual({ path: '/tmp/x' });
  });

  it('resumes and completes the remaining steps when the user approves', async () => {
    const harness = makeHarness({
      plan: () => [
        { toolName: 'safe', args: {}, description: 'S' },
        { toolName: 'danger', args: {}, description: 'D' },
        { toolName: 'after', args: {}, description: 'A' },
      ],
      results: { danger: { needsConfirmation: true, summary: 'Run it?' } },
    });
    const task = harness.engine.createTask({ userId: 'u1', title: 'T', goal: 'g' });
    await harness.flush();

    const paused = harness.engine.getTask(task.id);
    const stepId = paused?.steps[1].id as string;
    harness.engine.continueAfterDecision({
      taskId: task.id,
      stepId,
      decision: 'approve',
      output: 'user said yes',
    });
    await harness.flush();

    const final = harness.engine.getTask(task.id);
    expect(final?.status).toBe('completed');
    expect(final?.steps[1].status).toBe('completed');
    expect(final?.steps[1].result).toBe('user said yes');
    expect(final?.steps[2].status).toBe('completed');
    expect(harness.executorCalls).toEqual(['safe', 'danger', 'after']);
    expect(harness.audits).toContain('automation.task.complete');
  });

  it('fails the task when the user rejects a step', async () => {
    const harness = makeHarness({
      plan: () => [
        { toolName: 'safe', args: {}, description: 'S' },
        { toolName: 'danger', args: {}, description: 'D' },
      ],
      results: { danger: { needsConfirmation: true, summary: 'Run it?' } },
    });
    const task = harness.engine.createTask({ userId: 'u1', title: 'T', goal: 'g' });
    await harness.flush();

    const paused = harness.engine.getTask(task.id);
    harness.engine.continueAfterDecision({
      taskId: task.id,
      stepId: paused?.steps[1].id as string,
      decision: 'reject',
    });
    await harness.flush();

    const final = harness.engine.getTask(task.id);
    expect(final?.status).toBe('failed');
    expect(final?.steps[1].status).toBe('rejected');
    expect(final?.error).toContain('rejected');
    expect(harness.executorCalls).toEqual(['safe', 'danger']);
  });

  it('ignores resume calls for unknown tasks or unknown steps', async () => {
    const harness = makeHarness({
      plan: () => [{ toolName: 'safe', args: {}, description: 'S' }],
    });
    const task = harness.engine.createTask({ userId: 'u1', title: 'T', goal: 'g' });
    await harness.flush();
    expect(harness.engine.getTask(task.id)?.status).toBe('completed');

    harness.engine.continueAfterDecision({
      taskId: task.id,
      stepId: 'nope',
      decision: 'approve',
      output: 'x',
    });
    harness.engine.continueAfterDecision({
      taskId: 'missing',
      stepId: 'nope',
      decision: 'approve',
    });
    expect(harness.engine.getTask(task.id)?.status).toBe('completed');
  });

  it('cancels a task that is still queued', async () => {
    const harness = makeHarness({
      plan: () => [{ toolName: 'stepA', args: {}, description: 'A' }],
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    harness.queue.enqueue(() => gate);

    const task = harness.engine.createTask({ userId: 'u1', title: 'T', goal: 'g' });
    expect(task.status).toBe('queued');
    expect(harness.engine.cancel(task.id)).toBe(true);

    const current = harness.engine.getTask(task.id);
    expect(current?.status).toBe('cancelled');
    expect(harness.executorCalls).toEqual([]);

    release();
    await harness.flush();
    expect(harness.engine.getTask(task.id)?.status).toBe('cancelled');
  });

  it('cancels a running task via abort', async () => {
    const harness = makeHarness({
      plan: () => [{ toolName: 'blocked', args: {}, description: 'B' }],
      blocked: ['blocked'],
    });
    const task = harness.engine.createTask({ userId: 'u1', title: 'T', goal: 'g' });

    let guard = 0;
    while (!harness.executorCalls.includes('blocked')) {
      if (guard++ > 500) {
        throw new Error('executor never reached the blocked step');
      }
      await new Promise((resolve) => setTimeout(resolve, 1));
    }

    expect(harness.engine.cancel(task.id)).toBe(true);
    harness.release('blocked');
    await harness.flush();

    const current = harness.engine.getTask(task.id);
    expect(current?.status).toBe('cancelled');
    expect(harness.audits).toContain('automation.task.cancel');
  });

  it('cancels a task paused for confirmation', async () => {
    const harness = makeHarness({
      plan: () => [{ toolName: 'danger', args: {}, description: 'D' }],
      results: { danger: { needsConfirmation: true, summary: 'Sure?' } },
    });
    const task = harness.engine.createTask({ userId: 'u1', title: 'T', goal: 'g' });
    await harness.flush();
    expect(harness.engine.getTask(task.id)?.status).toBe('awaiting_confirmation');

    expect(harness.engine.cancel(task.id)).toBe(true);
    expect(harness.engine.getTask(task.id)?.status).toBe('cancelled');
    expect(harness.engine.cancel(task.id)).toBe(false);
  });

  it('rejects cancel/retry for tasks that cannot be cancelled or retried', async () => {
    const harness = makeHarness({ plan: () => [] });
    const task = harness.engine.createTask({ userId: 'u1', title: 'T', goal: 'g' });
    await harness.flush();
    expect(harness.engine.getTask(task.id)?.status).toBe('failed');

    expect(harness.engine.cancel(task.id)).toBe(false);
    expect(harness.engine.cancel('missing')).toBe(false);
    expect(harness.engine.retry('missing')).toBe(false);
  });

  it('retries a failed task from the start', async () => {
    const harness = makeHarness({
      plan: () => [{ toolName: 'flaky', args: {}, description: 'F' }],
      results: { flaky: { needsConfirmation: false, ok: false, output: 'Error: nope' } },
    });
    const task = harness.engine.createTask({
      userId: 'u1',
      title: 'T',
      goal: 'g',
      options: { maxRetries: 0 },
    });
    await harness.flush();
    expect(harness.engine.getTask(task.id)?.status).toBe('failed');

    expect(harness.engine.retry(task.id)).toBe(true);
    expect(harness.engine.retry(task.id)).toBe(false);
    await harness.flush();

    const current = harness.engine.getTask(task.id);
    expect(current?.status).toBe('failed');
    expect(current?.steps[0].attempts).toBeGreaterThanOrEqual(1);
    expect(harness.executorCalls).toEqual(['flaky', 'flaky']);
    expect(harness.audits).toContain('automation.task.retry');
  });

  it('emits events for every state transition', async () => {
    const harness = makeHarness({
      plan: () => [{ toolName: 'stepA', args: {}, description: 'A' }],
    });
    const statuses: string[] = [];
    harness.events.subscribe(({ task }) => statuses.push(task.status));

    const task = harness.engine.createTask({ userId: 'u1', title: 'T', goal: 'g' });
    await harness.flush();

    expect(statuses[0]).toBe('queued');
    expect(statuses).toContain('planning');
    expect(statuses).toContain('running');
    expect(statuses[statuses.length - 1]).toBe('completed');
    expect(harness.engine.getTask(task.id)?.status).toBe('completed');
  });

  it('only lists tasks for the requesting user', async () => {
    const harness = makeHarness({
      plan: () => [{ toolName: 'stepA', args: {}, description: 'A' }],
    });
    harness.engine.createTask({ userId: 'u1', title: 'mine', goal: 'g' });
    await harness.flush();
    harness.engine.createTask({ userId: 'u2', title: 'theirs', goal: 'g' });
    await harness.flush();

    expect(harness.engine.listTasks('u1')).toHaveLength(1);
    expect(harness.engine.listTasks('u1')[0].title).toBe('mine');
    expect(harness.engine.listTasks('u2')).toHaveLength(1);
  });

  it('derives the retry delay from the configured formula', async () => {
    const harness = makeHarness({
      plan: () => [{ toolName: 'flaky', args: {}, description: 'F' }],
      results: { flaky: { needsConfirmation: false, ok: false, output: 'Error: x' } },
    });
    const task = harness.engine.createTask({
      userId: 'u1',
      title: 'T',
      goal: 'g',
      options: { maxRetries: 2 },
    });
    await harness.flush();
    expect(harness.sleepCalls).toEqual([DEFAULT_RETRY_DELAY_MS, DEFAULT_RETRY_DELAY_MS * 2]);
    expect(harness.engine.getTask(task.id)?.status).toBe('failed');
  });
});

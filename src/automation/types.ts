export type TaskStatus =
  | 'queued'
  | 'planning'
  | 'running'
  | 'awaiting_confirmation'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type StepStatus =
  'queued' | 'running' | 'completed' | 'failed' | 'rejected' | 'awaiting_confirmation';

export type TaskLogLevel = 'info' | 'warn' | 'error';

export type TaskLogEntry = {
  at: string;
  level: TaskLogLevel;
  message: string;
};

export type TaskOptions = {
  maxRetries?: number;
  continueOnError?: boolean;
  notifyOnCompletion?: boolean;
};

export type PlannedStep = {
  toolName: string;
  args: Record<string, unknown>;
  description: string;
};

export type AutomationStep = PlannedStep & {
  id: string;
  order: number;
  status: StepStatus;
  result?: string;
  error?: string;
  attempts: number;
};

export type AutomationTask = {
  id: string;
  userId: string;
  title: string;
  goal: string;
  status: TaskStatus;
  options: Required<TaskOptions>;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  currentStepIndex: number;
  steps: AutomationStep[];
  logs: TaskLogEntry[];
};

export type TaskSnapshot = AutomationTask;

export type TaskPlannerContext = {
  userId: string;
};

export type TaskPlanner = {
  plan(input: { goal: string }, context?: TaskPlannerContext): Promise<PlannedStep[]>;
};

export type StepExecutionResult =
  | { needsConfirmation: true; summary: string }
  | { needsConfirmation: false; ok: boolean; output: string };

export type ToolExecutor = {
  runStepOnce(step: PlannedStep, context: { userId: string }): Promise<StepExecutionResult>;
};

export type Runnable = () => Promise<void>;

export type TaskQueue = {
  enqueue(runnable: Runnable): string;
  cancel(id: string): boolean;
  size: number;
  pending: number;
  running: number;
  clear(): void;
};

export type TaskListQuery = {
  limit?: number;
  status?: TaskStatus;
};

export type AutomationStore = {
  createTask(input: {
    userId: string;
    title: string;
    goal: string;
    options: Required<TaskOptions>;
  }): AutomationTask;
  getTask(id: string): AutomationTask | undefined;
  listTasksForUser(userId: string, query?: TaskListQuery): AutomationTask[];
  updateTask(id: string, patch: Partial<AutomationTask>): AutomationTask | undefined;
  clear(): void;
};

export type AutomationEvent = {
  task: TaskSnapshot;
};

export type EventBus = {
  subscribe(listener: (event: AutomationEvent) => void): () => void;
  emit(event: AutomationEvent): void;
  clear(): void;
};

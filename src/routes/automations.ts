import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { automationEngine } from '../automation/index.js';
import { config } from '../config/index.js';
import { HttpError, requireAuth, requireRole } from '../lib/auth.js';
import {
  isN8nConfigured,
  listN8nExecutions,
  listN8nWorkflows,
  n8nExecutionStatus,
  n8nNotConfiguredMessage,
  type N8nExecution,
  type N8nWorkflow,
} from '../integrations/n8n.js';

const createTaskSchema = z.object({
  title: z.string().trim().min(1).max(120),
  goal: z.string().trim().min(1).max(4000),
  options: z
    .object({
      maxRetries: z.number().int().min(0).max(10).optional(),
      continueOnError: z.boolean().optional(),
      notifyOnCompletion: z.boolean().optional(),
    })
    .optional(),
});

const taskListSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  status: z
    .enum([
      'queued',
      'planning',
      'running',
      'awaiting_confirmation',
      'completed',
      'failed',
      'cancelled',
    ])
    .optional(),
});

function workflowSummary(workflow: N8nWorkflow): {
  id: string;
  name: string;
  active: boolean;
} {
  return {
    id: String(workflow.id ?? ''),
    name: typeof workflow.name === 'string' ? workflow.name : 'Untitled workflow',
    active: workflow.active === true,
  };
}

function executionSummary(execution: N8nExecution): {
  id: string;
  workflowId: string;
  workflowName: string;
  status: string;
  startedAt: unknown;
  finishedAt: unknown;
} {
  const workflowData = (execution.workflowData ?? {}) as Record<string, unknown>;
  return {
    id: String(execution.id ?? ''),
    workflowId: typeof execution.workflowId === 'string' ? execution.workflowId : '',
    workflowName: typeof workflowData.name === 'string' ? workflowData.name : 'Untitled workflow',
    status: n8nExecutionStatus(execution),
    startedAt: execution.startedAt ?? null,
    finishedAt: execution.stoppedAt ?? null,
  };
}

function taskParam(params: unknown): string {
  return String((params as { id?: unknown }).id ?? '');
}

function ownedTask(userId: string, id: string) {
  const task = automationEngine.getTask(id);
  if (!task || task.userId !== userId) {
    return undefined;
  }
  return task;
}

export async function automationRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  app.get('/automations', { preHandler: requireRole('ADMIN') }, async () => {
    if (!isN8nConfigured()) {
      return {
        enabled: false,
        configured: false,
        workflows: [],
        executions: [],
        error: n8nNotConfiguredMessage(),
      };
    }

    try {
      const [workflows, { executions }] = await Promise.all([
        listN8nWorkflows(100, false),
        listN8nExecutions({ limit: 20 }),
      ]);
      return {
        enabled: true,
        configured: true,
        workflows: workflows.map(workflowSummary),
        executions: executions.map(executionSummary),
      };
    } catch (error) {
      return {
        enabled: true,
        configured: true,
        workflows: [],
        executions: [],
        error: error instanceof Error ? error.message : 'Failed to reach n8n',
      };
    }
  });

  app.post('/automations/tasks', async (request, reply) => {
    const parsed = createTaskSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new HttpError(400, 'Invalid request body');
    }
    const userId = request.user?.id;
    if (!userId) {
      throw new HttpError(401, 'Unauthorized');
    }
    const task = automationEngine.createTask({
      userId,
      title: parsed.data.title,
      goal: parsed.data.goal,
      ...(parsed.data.options ? { options: parsed.data.options } : {}),
    });
    return reply.status(201).send({ task });
  });

  app.get('/automations/tasks', async (request) => {
    const parsed = taskListSchema.safeParse(request.query);
    const userId = request.user?.id;
    if (!userId) {
      throw new HttpError(401, 'Unauthorized');
    }
    const tasks = automationEngine.listTasks(userId, parsed.success ? parsed.data : {});
    return { tasks };
  });

  app.get('/automations/tasks/:id', async (request) => {
    const userId = request.user?.id;
    if (!userId) {
      throw new HttpError(401, 'Unauthorized');
    }
    const task = ownedTask(userId, taskParam(request.params));
    if (!task) {
      throw new HttpError(404, 'Task not found');
    }
    return { task };
  });

  app.post('/automations/tasks/:id/cancel', async (request) => {
    const userId = request.user?.id;
    if (!userId) {
      throw new HttpError(401, 'Unauthorized');
    }
    const id = taskParam(request.params);
    if (!ownedTask(userId, id)) {
      throw new HttpError(404, 'Task not found');
    }
    if (!automationEngine.cancel(id)) {
      throw new HttpError(409, 'Task is not cancellable');
    }
    const task = automationEngine.getTask(id);
    return { task };
  });

  app.post('/automations/tasks/:id/retry', async (request) => {
    const userId = request.user?.id;
    if (!userId) {
      throw new HttpError(401, 'Unauthorized');
    }
    const id = taskParam(request.params);
    if (!ownedTask(userId, id)) {
      throw new HttpError(404, 'Task not found');
    }
    if (!automationEngine.retry(id)) {
      throw new HttpError(409, 'Only failed or cancelled tasks can be retried');
    }
    const task = automationEngine.getTask(id);
    return { task };
  });

  app.get('/automations/tasks/:id/stream', async (request, reply) => {
    const userId = request.user?.id;
    if (!userId) {
      throw new HttpError(401, 'Unauthorized');
    }
    const id = taskParam(request.params);
    if (!ownedTask(userId, id)) {
      throw new HttpError(404, 'Task not found');
    }

    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      // reply.hijack() bypasses @fastify/cors (which attaches headers in its
      // onSend hook), so the hijacked SSE response must carry the CORS headers
      // itself or the browser will drop the stream for cross-origin requests.
      'Access-Control-Allow-Origin': config.corsOrigin,
      'Access-Control-Allow-Credentials': 'true',
    });

    const send = (event: Record<string, unknown>): void => {
      if (reply.raw.writableEnded || reply.raw.destroyed) {
        return;
      }
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    send({ type: 'snapshot', task: automationEngine.getTask(id) });

    const unsubscribe = automationEngine.onTaskEvent(({ task: updated }) => {
      if (updated.id === id) {
        send({ type: 'update', task: updated });
      }
    });
    const ping = setInterval(() => send({ type: 'ping' }), 15000);
    const onClose = (): void => {
      clearInterval(ping);
      unsubscribe();
    };
    request.raw.once('close', onClose);
  });
}

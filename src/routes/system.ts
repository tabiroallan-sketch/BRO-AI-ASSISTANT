import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { automationEngine } from '../automation/index.js';
import { HttpError, requireAuth } from '../lib/auth.js';
import { recordAudit } from '../lib/audit.js';
import { getTool } from '../tools/registry.js';
import { listTools } from '../tools/registry.js';
import {
  decideAction,
  expireStale,
  getPendingAction,
  listActionsForUser,
  markActionResult,
  type PendingAction,
} from '../system/index.js';
import { validateToolOutput } from '../lib/output-validate.js';

const decisionSchema = z.object({
  decision: z.enum(['approve', 'reject']),
});

const listSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

function serializeAction(action: PendingAction): PendingAction {
  return action;
}

export async function systemRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  app.get('/system/actions', async (request) => {
    const parsed = listSchema.safeParse(request.query);
    const limit = parsed.success ? parsed.data.limit : undefined;
    const userId = request.user?.id;
    if (!userId) {
      throw new HttpError(401, 'Unauthorized');
    }
    expireStale();
    const actions = listActionsForUser(userId, limit);
    const systemTools = listTools()
      .filter((tool) => tool.name.startsWith('system_'))
      .map((tool) => ({
        name: tool.name,
        description: tool.description,
        requireConfirmation: Boolean(tool.requireConfirmation),
      }));
    return {
      actions: actions.map(serializeAction),
      tools: systemTools,
    };
  });

  app.post('/system/actions/:id/decision', async (request, reply) => {
    const parsed = decisionSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new HttpError(400, 'Invalid request body');
    }
    const userId = request.user?.id;
    if (!userId) {
      throw new HttpError(401, 'Unauthorized');
    }
    const id = String((request.params as { id: string }).id ?? '');
    const action = getPendingAction(id);
    if (!action) {
      throw new HttpError(404, 'Pending action not found');
    }
    if (action.userId !== userId) {
      throw new HttpError(403, 'Forbidden: you do not own this action');
    }
    expireStale();
    const decided = decideAction(id, parsed.data.decision);
    if (!decided) {
      throw new HttpError(409, 'This action is no longer pending');
    }
    if (decided.status === 'expired') {
      throw new HttpError(409, 'This approval request has expired');
    }

    if (decided.status === 'rejected') {
      recordAudit({
        actorId: userId,
        action: 'system.action.reject',
        target: decided.toolName,
        detail: decided.summary,
      });
      if (decided.taskId && decided.stepId) {
        automationEngine.continueAfterDecision({
          taskId: decided.taskId,
          stepId: decided.stepId,
          decision: 'reject',
        });
      }
      return { action: serializeAction(decided) };
    }

    const tool = getTool(decided.toolName);
    if (!tool) {
      throw new HttpError(404, `Unknown tool "${decided.toolName}"`);
    }
    let result: string;
    try {
      result = validateToolOutput(await tool.execute(decided.args, { userId }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      markActionResult(id, `Error: ${message}`);
      recordAudit({
        actorId: userId,
        action: 'system.action.approve',
        target: decided.toolName,
        detail: `${decided.summary} — failed: ${message}`,
      });
      if (decided.taskId && decided.stepId) {
        automationEngine.continueAfterDecision({
          taskId: decided.taskId,
          stepId: decided.stepId,
          decision: 'approve',
          output: `Error: ${message}`,
        });
      }
      return reply
        .status(200)
        .send({ action: serializeAction({ ...decided, result: `Error: ${message}` }) });
    }
    const updated = markActionResult(id, result) ?? { ...decided, result };
    recordAudit({
      actorId: userId,
      action: 'system.action.approve',
      target: decided.toolName,
      detail: `${decided.summary} — ${result}`,
    });
    if (decided.taskId && decided.stepId) {
      automationEngine.continueAfterDecision({
        taskId: decided.taskId,
        stepId: decided.stepId,
        decision: 'approve',
        output: result,
      });
    }
    return { action: serializeAction(updated) };
  });
}

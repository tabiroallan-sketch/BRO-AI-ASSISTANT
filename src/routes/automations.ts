import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../lib/auth.js';
import {
  isN8nConfigured,
  listN8nExecutions,
  listN8nWorkflows,
  n8nExecutionStatus,
  n8nNotConfiguredMessage,
  type N8nExecution,
  type N8nWorkflow,
} from '../integrations/n8n.js';

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

export async function automationRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  app.get('/automations', async () => {
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
}

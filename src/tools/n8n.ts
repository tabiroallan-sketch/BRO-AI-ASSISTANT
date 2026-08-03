import type { Tool } from './types.js';
import {
  executeN8nWorkflow,
  getN8nExecution,
  getN8nWorkflow,
  isN8nConfigured,
  listN8nExecutions,
  listN8nWorkflows,
  n8nExecutionStatus,
  n8nNotConfiguredMessage,
  stopN8nExecution,
  waitForN8nExecution,
  type N8nExecution,
  type N8nWorkflow,
} from '../integrations/n8n.js';

function requireN8n(): void {
  if (!isN8nConfigured()) {
    throw new Error(n8nNotConfiguredMessage());
  }
}

function argString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function argNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function parseVariables(raw: unknown): unknown {
  if (typeof raw !== 'string') {
    return raw ?? {};
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return {};
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return raw;
  }
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, maxChars)}...[truncated, ${text.length - maxChars} more characters]`;
}

function workflowLine(workflow: N8nWorkflow): string {
  const id = String(workflow.id ?? 'unknown');
  const name = String(workflow.name ?? '(unnamed)');
  const active = workflow.active === true ? 'active' : 'inactive';
  const updatedAt = typeof workflow.updatedAt === 'string' ? workflow.updatedAt : '';
  return `#${id} ${name} [${active}]${updatedAt ? ` (updated ${updatedAt})` : ''}`;
}

function executionLine(execution: N8nExecution): string {
  const id = String(execution.id ?? 'unknown');
  const workflowName = typeof execution.workflowName === 'string' ? execution.workflowName : '';
  const status = n8nExecutionStatus(execution);
  const startedAt = typeof execution.startedAt === 'string' ? execution.startedAt : '';
  const stoppedAt = typeof execution.stoppedAt === 'string' ? execution.stoppedAt : '';
  const when = stoppedAt || startedAt;
  return `#${id} ${status}${workflowName ? ` ${workflowName}` : ''}${when ? ` (${when})` : ''}`;
}

type RunDataShape = {
  resultData?: {
    runData?: Record<string, Array<Record<string, unknown>>>;
    lastNodeExecuted?: string;
  };
};

function formatExecutionResults(execution: N8nExecution, maxItems: number): string {
  const data = execution.data as RunDataShape | undefined;
  const runData = data?.resultData?.runData;
  if (!runData) {
    return '';
  }
  const lines: string[] = [];
  for (const [nodeName, runs] of Object.entries(runData)) {
    for (const run of runs ?? []) {
      const main = run.data as
        { main?: Array<Array<{ json?: unknown } | null> | null> } | undefined;
      for (const branch of main?.main ?? []) {
        for (const item of branch ?? []) {
          if (lines.length >= maxItems) {
            break;
          }
          if (item?.json !== undefined) {
            lines.push(`${nodeName}: ${truncate(JSON.stringify(item.json), 600)}`);
          }
        }
      }
    }
  }
  return lines.join('\n');
}

export const n8nListWorkflowsTool: Tool = {
  name: 'n8n_list_workflows',
  description:
    'List the workflows in the n8n instance (optionally only active ones). Each entry shows the workflow id, name, whether it is active, and when it was last updated. Use the workflow id with n8n_execute_workflow.',
  parameters: {
    type: 'object',
    properties: {
      limit: {
        type: 'number',
        description: 'Maximum number of workflows to return (default 25, max 100).',
      },
      activeOnly: {
        type: 'boolean',
        description: 'Set to true to only list active workflows (default false).',
      },
    },
  },
  async execute(args) {
    requireN8n();
    const limit = argNumber(args.limit, 25);
    const activeOnly = args.activeOnly === true;
    const workflows = await listN8nWorkflows(limit, activeOnly);
    if (workflows.length === 0) {
      return activeOnly ? 'No active workflows found.' : 'No workflows found in the n8n instance.';
    }
    const header = activeOnly
      ? `Active workflows (${workflows.length}):`
      : `Workflows (${workflows.length}):`;
    return [header, ...workflows.map(workflowLine)].join('\n');
  },
};

export const n8nGetWorkflowTool: Tool = {
  name: 'n8n_get_workflow',
  description:
    'Get details of a single n8n workflow by its workflow id: name, active state, trigger count, and the list of node names. Use n8n_list_workflows to find the id.',
  parameters: {
    type: 'object',
    properties: {
      workflowId: { type: 'string', description: 'The n8n workflow id, e.g. "42".' },
    },
    required: ['workflowId'],
  },
  async execute(args) {
    const workflowId = argString(args.workflowId);
    if (!workflowId) {
      throw new Error('A "workflowId" is required.');
    }
    requireN8n();
    const workflow = await getN8nWorkflow(workflowId);
    const name = String(workflow.name ?? '(unnamed)');
    const active = workflow.active === true ? 'active' : 'inactive';
    const triggerCount = typeof workflow.triggerCount === 'number' ? workflow.triggerCount : 0;
    const nodes = Array.isArray(workflow.nodes)
      ? (workflow.nodes as Array<{ name?: string }>)
          .map((node) => String(node.name ?? 'unnamed'))
          .filter(Boolean)
      : [];
    const lines = [
      `Workflow #${workflowId}: ${name}`,
      `Status: ${active}`,
      `Triggers: ${triggerCount}`,
      `Nodes (${nodes.length}): ${nodes.join(', ') || '(none)'}`,
    ];
    return lines.join('\n');
  },
};

export const n8nExecuteWorkflowTool: Tool = {
  name: 'n8n_execute_workflow',
  description:
    'Trigger an n8n workflow by id and optionally pass variables to it (passed into the first node of the workflow). With "wait" (default true) it polls until the workflow finishes and returns the result data from its nodes; with wait=false it returns the execution id immediately so it can be monitored with n8n_get_execution or n8n_list_executions.',
  parameters: {
    type: 'object',
    properties: {
      workflowId: { type: 'string', description: 'The n8n workflow id to execute.' },
      variables: {
        type: 'string',
        description:
          'Optional JSON object of variables to pass to the workflow, e.g. {"email":"a@b.com"}.',
      },
      wait: {
        type: 'boolean',
        description: 'Wait for the workflow to finish and return its results (default true).',
      },
      waitTimeoutMs: {
        type: 'number',
        description:
          'How long to wait for the workflow in milliseconds when wait=true (default 60000).',
      },
      pollIntervalMs: {
        type: 'number',
        description: 'How often to poll the execution status in milliseconds (default 1000).',
      },
      maxItems: {
        type: 'number',
        description: 'Maximum number of result items to return (default 10).',
      },
    },
    required: ['workflowId'],
  },
  async execute(args) {
    const workflowId = argString(args.workflowId);
    if (!workflowId) {
      throw new Error('A "workflowId" is required.');
    }
    requireN8n();
    const execution = await executeN8nWorkflow(workflowId, parseVariables(args.variables));
    const executionId = argString(execution.executionId) ?? argString(execution.id);
    if (!executionId) {
      throw new Error('n8n did not return an execution id for the triggered workflow.');
    }
    const wait = args.wait !== false;
    if (!wait) {
      return `Workflow #${workflowId} triggered. Execution #${executionId} (status: ${n8nExecutionStatus(execution)}). Monitor it with n8n_get_execution.`;
    }

    const finished = await waitForN8nExecution(executionId, {
      timeoutMs: argNumber(args.waitTimeoutMs, 60_000),
      pollMs: argNumber(args.pollIntervalMs, 1000),
    });
    const status = n8nExecutionStatus(finished);
    const lines = [
      `Workflow #${workflowId} finished (execution #${executionId}).`,
      `Status: ${status}`,
    ];
    if (finished.timedOut === true) {
      lines.push('Note: timed out while waiting; the workflow may still be running.');
    }
    const results = formatExecutionResults(finished, argNumber(args.maxItems, 10));
    if (results) {
      lines.push(`Results:\n${results}`);
    }
    return lines.join('\n');
  },
};

export const n8nGetExecutionTool: Tool = {
  name: 'n8n_get_execution',
  description:
    'Get the status and results of an n8n execution by id: status, timestamps, workflow, and (when includeData is true) the output data of each node. Use to monitor a workflow or receive its results.',
  parameters: {
    type: 'object',
    properties: {
      executionId: { type: 'string', description: 'The n8n execution id.' },
      includeData: {
        type: 'boolean',
        description: 'Include node output data (default true). Set false for a quick status check.',
      },
      maxItems: {
        type: 'number',
        description: 'Maximum number of result items to return (default 10).',
      },
    },
    required: ['executionId'],
  },
  async execute(args) {
    const executionId = argString(args.executionId);
    if (!executionId) {
      throw new Error('An "executionId" is required.');
    }
    requireN8n();
    const includeData = args.includeData !== false;
    const execution = await getN8nExecution(executionId, includeData);
    const status = n8nExecutionStatus(execution);
    const startedAt = typeof execution.startedAt === 'string' ? execution.startedAt : '';
    const stoppedAt = typeof execution.stoppedAt === 'string' ? execution.stoppedAt : '';
    const workflowName = typeof execution.workflowName === 'string' ? execution.workflowName : '';
    const lastNode =
      typeof execution.lastNodeExecuted === 'string' ? execution.lastNodeExecuted : '';
    const lines = [
      `Execution #${executionId}`,
      `Status: ${status}`,
      workflowName ? `Workflow: ${workflowName}` : '',
      startedAt ? `Started: ${startedAt}` : '',
      stoppedAt ? `Stopped: ${stoppedAt}` : '',
      lastNode ? `Last node: ${lastNode}` : '',
    ].filter(Boolean);
    const results = includeData
      ? formatExecutionResults(execution, argNumber(args.maxItems, 10))
      : '';
    if (results) {
      lines.push(`Results:\n${results}`);
    }
    return lines.join('\n');
  },
};

export const n8nListExecutionsTool: Tool = {
  name: 'n8n_list_executions',
  description:
    'Monitor n8n by listing recent executions (optionally filtered by status, e.g. "running", "success", "error"). Each entry shows the execution id, status, workflow name, and timestamp. Use to display workflow status or check for failures.',
  parameters: {
    type: 'object',
    properties: {
      limit: {
        type: 'number',
        description: 'Maximum number of executions to return (default 20, max 100).',
      },
      status: {
        type: 'string',
        description: 'Optional status filter: running, success, error, waiting, crashed, canceled.',
      },
    },
  },
  async execute(args) {
    requireN8n();
    const status = argString(args.status);
    const { count, executions } = await listN8nExecutions({
      limit: argNumber(args.limit, 20),
      status,
    });
    if (executions.length === 0) {
      return status ? `No executions with status "${status}" found.` : 'No executions found.';
    }
    const header = `Executions (${executions.length} of ${count} total):`;
    return [header, ...executions.map(executionLine)].join('\n');
  },
};

export const n8nStopExecutionTool: Tool = {
  name: 'n8n_stop_execution',
  description:
    'Stop a running n8n execution by its execution id (this cancels the execution). Use n8n_list_executions to find a running execution id.',
  parameters: {
    type: 'object',
    properties: {
      executionId: { type: 'string', description: 'The n8n execution id to stop.' },
    },
    required: ['executionId'],
  },
  async execute(args) {
    const executionId = argString(args.executionId);
    if (!executionId) {
      throw new Error('An "executionId" is required.');
    }
    requireN8n();
    await stopN8nExecution(executionId);
    return `Execution #${executionId} stopped.`;
  },
};

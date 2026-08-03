import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  n8nExecuteWorkflowTool,
  n8nGetExecutionTool,
  n8nGetWorkflowTool,
  n8nListExecutionsTool,
  n8nListWorkflowsTool,
  n8nStopExecutionTool,
} from '../src/tools/n8n.js';

type MockFetchInit = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
};

process.env.DATABASE_URL = '';
process.env.REDIS_URL = '';
process.env.JWT_SECRET = 'test-access-secret';

const { mockConfig } = vi.hoisted(() => {
  const mockConfig: { n8nBaseUrl: string; n8nApiKey: string } = {
    n8nBaseUrl: '',
    n8nApiKey: '',
  };
  return { mockConfig };
});

vi.mock('../src/config/index.js', () => ({ config: mockConfig }));

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe('n8n tools', () => {
  beforeEach(() => {
    mockConfig.n8nBaseUrl = 'http://n8n.local';
    mockConfig.n8nApiKey = 'n8n_key';
    vi.unstubAllGlobals();
  });

  it('rejects when n8n is not configured', async () => {
    mockConfig.n8nBaseUrl = '';
    mockConfig.n8nApiKey = '';
    await expect(n8nListWorkflowsTool.execute({}, { userId: 'u' })).rejects.toThrow(
      /n8n is not configured/,
    );
    await expect(
      n8nExecuteWorkflowTool.execute({ workflowId: '1' }, { userId: 'u' }),
    ).rejects.toThrow(/n8n is not configured/);
  });

  it('lists workflows with the active filter and sends the API key', async () => {
    const fetchMock = vi.fn(async (_input: string, _init?: MockFetchInit) =>
      jsonResponse({
        data: [
          { id: '1', name: 'Daily Digest', active: true, updatedAt: '2026-08-03T10:00:00Z' },
          { id: '2', name: 'Nightly Backup', active: false, updatedAt: '2026-08-01T08:00:00Z' },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await n8nListWorkflowsTool.execute({ activeOnly: true }, { userId: 'u' });
    expect(result).toContain('Daily Digest');
    expect(result).toContain('[active]');
    expect(result).toContain('Nightly Backup');
    expect(result).toContain('[inactive]');

    const [input, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(input)).toBe('http://n8n.local/api/v1/workflows?limit=25&active=true');
    const headers = init?.headers ?? {};
    expect(headers['X-N8N-API-KEY']).toBe('n8n_key');
  });

  it('reports when there are no workflows', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ data: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await n8nListWorkflowsTool.execute({}, { userId: 'u' });
    expect(result).toContain('No workflows found');
  });

  it('gets a workflow with its node names', async () => {
    const fetchMock = vi.fn(async (_input: string) =>
      jsonResponse({
        data: {
          id: '1',
          name: 'Order Pipeline',
          active: true,
          triggerCount: 2,
          nodes: [
            { name: 'Schedule Trigger' },
            { name: 'HTTP Request' },
            { name: 'Set Variables' },
          ],
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await n8nGetWorkflowTool.execute({ workflowId: '1' }, { userId: 'u' });
    expect(result).toContain('Order Pipeline');
    expect(result).toContain('active');
    expect(result).toContain('Schedule Trigger');
    expect(result).toContain('HTTP Request');
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/api/v1/workflows/1');
  });

  it('executes a workflow without waiting and passes parsed variables', async () => {
    const fetchMock = vi.fn(async (_input: string, _init?: MockFetchInit) =>
      jsonResponse({
        data: { executionId: '10', workflowId: '1', mode: 'manual', finishedAt: null },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await n8nExecuteWorkflowTool.execute(
      { workflowId: '1', variables: '{"email":"a@b.com","amount":42}', wait: false },
      { userId: 'u' },
    );
    expect(result).toContain('Execution #10');

    const [input, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(input)).toBe('http://n8n.local/api/v1/workflows/1/execute');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body ?? '{}')).toEqual({
      data: { email: 'a@b.com', amount: 42 },
    });
  });

  it('executes a workflow with an object of variables', async () => {
    const fetchMock = vi.fn(async (_input: string, _init?: MockFetchInit) =>
      jsonResponse({ data: { executionId: '11' } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await n8nExecuteWorkflowTool.execute(
      { workflowId: '1', variables: { x: 1, nested: { ok: true } }, wait: false },
      { userId: 'u' },
    );
    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(JSON.parse(init?.body ?? '{}')).toEqual({
      data: { x: 1, nested: { ok: true } },
    });
  });

  it('waits for a workflow and returns its result data', async () => {
    let pollCount = 0;
    const fetchMock = vi.fn(async (input: string) => {
      if (input.includes('/execute')) {
        return jsonResponse({ data: { executionId: '10' } });
      }
      pollCount += 1;
      if (pollCount === 1) {
        return jsonResponse({
          data: { id: '10', status: 'running', workflowName: 'Order Pipeline' },
        });
      }
      return jsonResponse({
        data: {
          id: '10',
          status: 'success',
          workflowName: 'Order Pipeline',
          startedAt: '2026-08-03T10:00:00Z',
          stoppedAt: '2026-08-03T10:00:05Z',
          data: {
            resultData: {
              runData: {
                Webhook: [{ data: { main: [[{ json: { message: 'order received' } }]] } }],
              },
            },
          },
        },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await n8nExecuteWorkflowTool.execute(
      { workflowId: '1', waitTimeoutMs: 5000, pollIntervalMs: 10 },
      { userId: 'u' },
    );
    expect(result).toContain('Status: success');
    expect(result).toContain('order received');
    expect(pollCount).toBeGreaterThanOrEqual(2);
  });

  it('gets an execution with status and results', async () => {
    const fetchMock = vi.fn(async (_input: string) =>
      jsonResponse({
        data: {
          id: '5',
          status: 'error',
          workflowName: 'Nightly Backup',
          startedAt: '2026-08-03T09:00:00Z',
          stoppedAt: '2026-08-03T09:00:02Z',
          lastNodeExecuted: 'HTTP Request',
          data: {
            resultData: {
              runData: {
                'HTTP Request': [{ data: { main: [[{ json: { status: 500 } }]] } }],
              },
            },
          },
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await n8nGetExecutionTool.execute({ executionId: '5' }, { userId: 'u' });
    expect(result).toContain('Execution #5');
    expect(result).toContain('Status: error');
    expect(result).toContain('Nightly Backup');
    expect(result).toContain('HTTP Request: {"status":500}');
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/api/v1/executions/5?includeData=true');
  });

  it('lists executions and displays workflow status', async () => {
    const fetchMock = vi.fn(async (_input: string) =>
      jsonResponse({
        data: {
          count: 2,
          executions: [
            {
              id: '1',
              status: 'success',
              workflowName: 'Daily Digest',
              stoppedAt: '2026-08-03T08:00:00Z',
            },
            { id: '2', status: 'running', workflowName: 'Nightly Backup' },
          ],
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await n8nListExecutionsTool.execute({ status: 'running' }, { userId: 'u' });
    expect(result).toContain('2 of 2 total');
    expect(result).toContain('success Daily Digest');
    expect(result).toContain('running Nightly Backup');
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('status=running');
  });

  it('stops a running execution via DELETE', async () => {
    const fetchMock = vi.fn(async (_input: string, _init?: MockFetchInit) =>
      jsonResponse({ data: { success: true, id: '2' } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await n8nStopExecutionTool.execute({ executionId: '2' }, { userId: 'u' });
    expect(result).toContain('Execution #2 stopped');
    const [input, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(input)).toBe('http://n8n.local/api/v1/executions/2');
    expect(init?.method).toBe('DELETE');
  });
});

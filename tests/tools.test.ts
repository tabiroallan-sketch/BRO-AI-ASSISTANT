import { beforeEach, describe, expect, it } from 'vitest';
import { calculateTool } from '../src/tools/calculate.js';
import { currentTimeTool } from '../src/tools/current-time.js';
import { echoTool } from '../src/tools/echo.js';
import {
  clearTools,
  getTool,
  listTools,
  registerTool,
  unregisterTool,
} from '../src/tools/registry.js';
import type { Tool, ToolContext } from '../src/tools/types.js';

const context: ToolContext = { userId: 'test-user' };

function makeTool(name: string): Tool {
  return {
    name,
    description: `The ${name} tool`,
    parameters: { type: 'object', properties: {} },
    execute: async () => name,
  };
}

beforeEach(() => {
  clearTools();
});

describe('tool registry', () => {
  it('registers, lists, and fetches tools', () => {
    registerTool(makeTool('alpha'));
    registerTool(makeTool('beta'));

    expect(listTools().map((tool) => tool.name)).toEqual(['alpha', 'beta']);
    expect(getTool('alpha')?.name).toBe('alpha');
    expect(getTool('missing')).toBeUndefined();
  });

  it('overwrites a tool with the same name', () => {
    registerTool(makeTool('alpha'));
    registerTool({ ...makeTool('alpha'), description: 'updated' });

    expect(listTools()).toHaveLength(1);
    expect(getTool('alpha')?.description).toBe('updated');
  });

  it('unregisters a tool', () => {
    registerTool(makeTool('alpha'));

    expect(unregisterTool('alpha')).toBe(true);
    expect(unregisterTool('alpha')).toBe(false);
    expect(listTools()).toHaveLength(0);
  });

  it('clears all tools', () => {
    registerTool(makeTool('alpha'));
    registerTool(makeTool('beta'));
    clearTools();
    expect(listTools()).toHaveLength(0);
  });
});

describe('built-in tools', () => {
  beforeEach(() => {
    registerTool(currentTimeTool);
    registerTool(calculateTool);
    registerTool(echoTool);
  });

  it('registers the expected built-in tools', () => {
    const names = listTools().map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining(['get_current_time', 'calculate', 'echo']));
  });

  it('echoes the given text', async () => {
    const tool = getTool('echo');
    expect(tool).toBeDefined();
    expect(await tool?.execute({ text: 'hello' }, context)).toBe('hello');
    expect(await tool?.execute({}, context)).toBe('');
  });

  it('evaluates arithmetic expressions', async () => {
    const tool = getTool('calculate');
    expect(tool).toBeDefined();
    const cases: Array<[string, string]> = [
      ['2+3*4', '14'],
      ['(2 + 3) * 4', '20'],
      ['10 % 3', '1'],
      ['2^10', '1024'],
      ['-5 + 3', '-2'],
      ['10 / 4', '2.5'],
      ['7 * 6', '42'],
    ];
    for (const [expression, expected] of cases) {
      expect(await tool?.execute({ expression }, context)).toBe(expected);
    }
  });

  it('rejects invalid or unsafe expressions', () => {
    const tool = getTool('calculate');
    expect(tool).toBeDefined();
    expect(() => tool?.execute({ expression: 'abc' }, context)).toThrow();
    expect(() => tool?.execute({ expression: '1/0' }, context)).toThrow();
    expect(() => tool?.execute({ expression: '' }, context)).toThrow();
    expect(() => tool?.execute({ expression: '2+2 junk' }, context)).toThrow();
    expect(() => tool?.execute({ expression: '(2+3' }, context)).toThrow();
  });

  it('returns the current time in ISO format', async () => {
    const tool = getTool('get_current_time');
    expect(tool).toBeDefined();
    const before = Date.now();
    const output = await tool?.execute({}, context);
    const after = Date.now();
    expect(output).toBeTruthy();
    const iso = String(output).match(/ISO 8601 \(UTC\): (.+)$/m)?.[1];
    expect(iso).toBeTruthy();
    const parsed = Date.parse(iso as string);
    expect(Number.isNaN(parsed)).toBe(false);
    expect(parsed).toBeGreaterThanOrEqual(before);
    expect(parsed).toBeLessThanOrEqual(after);
  });
});

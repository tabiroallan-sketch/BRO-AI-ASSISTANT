import { describe, expect, it } from 'vitest';
import {
  clearTools,
  getTool,
  listTools,
  registerTool,
  unregisterTool,
} from '../../src/tools/registry.js';
import type { Tool } from '../../src/tools/types.js';

const makeTool = (name: string): Tool => ({
  name,
  description: `Description for ${name}`,
  parameters: {
    type: 'object',
    properties: {},
  },
  execute: () => 'ok',
});

describe('tool registry', () => {
  it('registers and retrieves tools by name', () => {
    clearTools();
    registerTool(makeTool('alpha'));
    expect(getTool('alpha')).toBeDefined();
    expect(getTool('missing')).toBeUndefined();
  });

  it('lists registered tools', () => {
    clearTools();
    registerTool(makeTool('alpha'));
    registerTool(makeTool('beta'));
    expect(
      listTools()
        .map((tool) => tool.name)
        .sort(),
    ).toEqual(['alpha', 'beta']);
  });

  it('refuses to overwrite a tool with the same name', () => {
    clearTools();
    registerTool(makeTool('alpha'));
    const replaced = registerTool({ ...makeTool('alpha'), description: 'Replacement' });
    expect(replaced).toBe(false);
    expect(listTools().filter((tool) => tool.name === 'alpha')).toHaveLength(1);
    expect(getTool('alpha')?.description).toBe('Description for alpha');
  });

  it('unregisters tools and reports success', () => {
    clearTools();
    registerTool(makeTool('alpha'));
    expect(unregisterTool('alpha')).toBe(true);
    expect(getTool('alpha')).toBeUndefined();
    expect(unregisterTool('alpha')).toBe(false);
  });

  it('clears all tools', () => {
    clearTools();
    registerTool(makeTool('alpha'));
    registerTool(makeTool('beta'));
    clearTools();
    expect(listTools()).toEqual([]);
  });
});

import type { Tool } from './types.js';

const tools = new Map<string, Tool>();

export function registerTool(tool: Tool): void {
  tools.set(tool.name, tool);
}

export function unregisterTool(name: string): boolean {
  return tools.delete(name);
}

export function getTool(name: string): Tool | undefined {
  return tools.get(name);
}

export function listTools(): Tool[] {
  return [...tools.values()];
}

export function clearTools(): void {
  tools.clear();
}

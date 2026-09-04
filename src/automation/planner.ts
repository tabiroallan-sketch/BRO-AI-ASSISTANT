import type { LLMChatRequest } from '../llm/types/index.js';
import type { Tool } from '../tools/types.js';
import type { PlannedStep, TaskPlanner } from './types.js';

export const MAX_PLAN_STEPS = 8;

function extractPhrase(goal: string, pattern: RegExp): string | undefined {
  const match = goal.match(pattern);
  const raw = match?.[1]?.trim();
  return raw ? raw : undefined;
}

const TOOL_RECIPES: Array<{
  test: (goal: string) => string | undefined;
  build: (capture: string) => PlannedStep | null;
}> = [
  {
    test: (goal) => extractPhrase(goal, /(?:launch|open|start)\s+["']?([a-z0-9 ._/-]+)/i),
    build: (name) => ({
      toolName: 'system_launch_app',
      args: { name },
      description: `Launch ${name}`,
    }),
  },
  {
    test: (goal) =>
      /search|find|locate/.test(goal) && /file|folder|doc/.test(goal)
        ? (extractPhrase(goal, /(?:search|find|locate)\s+["']?(.+?)["']?\s*$/i) ?? 'files')
        : undefined,
    build: (query) => ({
      toolName: 'system_search_files',
      args: { query },
      description: `Search the computer for "${query}"`,
    }),
  },
  {
    test: (goal) =>
      /terminate|kill|close (?:the )?(?:app|program|process)/.test(goal)
        ? extractPhrase(goal, /(?:terminate|kill)\s+["']?([a-z0-9 ._/-]+)/i)
        : undefined,
    build: (name) => ({
      toolName: 'system_terminate_app',
      args: { name },
      description: `Terminate ${name}`,
    }),
  },
  {
    test: (goal) =>
      /run|execute|shell|command|install|setup|update|upgrade/.test(goal)
        ? (extractPhrase(goal, /(?:run|execute)\s+["']?(.+?)["']?$/i) ?? goal)
        : undefined,
    build: (command) => ({
      toolName: 'system_run_command',
      args: { command },
      description: `Run shell command: ${command}`,
    }),
  },
  {
    test: (goal) => (/weather/.test(goal) ? 'current location' : undefined),
    build: (location) => ({
      toolName: 'weather',
      args: { location },
      description: `Check the weather for ${location}`,
    }),
  },
  {
    test: (goal) => (/time|date/.test(goal) && !/weather/.test(goal) ? 'now' : undefined),
    build: () => ({ toolName: 'current_time', args: {}, description: 'Get the current time' }),
  },
  {
    test: (goal) => (/search the web|research|look up|online/.test(goal) ? goal : undefined),
    build: (query) => ({
      toolName: 'web_search',
      args: { query },
      description: `Search the web for "${query}"`,
    }),
  },
  {
    test: (goal) => (/notify|remind|alert me/.test(goal) ? goal : undefined),
    build: (query) => ({
      toolName: 'notify',
      args: { title: `Reminder: ${query}` },
      description: `Notify the user about: ${query}`,
    }),
  },
  {
    test: (goal) =>
      /list (?:processes|apps? running)/.test(goal)
        ? (goal.match(/list (?:processes|apps? running)/i)?.[0] ?? 'processes')
        : undefined,
    build: () => ({
      toolName: 'system_list_processes',
      args: {},
      description: 'List running processes',
    }),
  },
];

/**
 * Deterministic, offline task planner. Decomposes a goal into a short recipe of
 * tool calls using keyword matching. Used as the fallback when the LLM planner
 * is unavailable (no AI provider configured) or produces no usable plan.
 */
export function createHeuristicPlanner(options: { getTools(): Tool[] }): TaskPlanner {
  return {
    async plan(input): Promise<PlannedStep[]> {
      const goal = input.goal.trim().toLowerCase();
      const available = new Set(options.getTools().map((tool) => tool.name));
      const steps: PlannedStep[] = [];

      for (const recipe of TOOL_RECIPES) {
        const capture = recipe.test(goal);
        if (capture === undefined) {
          continue;
        }
        const step = recipe.build(capture);
        if (step && available.has(step.toolName)) {
          steps.push(step);
          break;
        }
      }
      return steps;
    },
  };
}

const PLANNER_SYSTEM_PROMPT =
  'You are a task planner for an AI assistant that controls a computer and works with tools. ' +
  "Break the user's goal into the shortest sequence of tool calls that achieves it. " +
  'Respond with ONLY valid JSON in this exact shape: ' +
  '{"steps":[{"toolName":"...","args":{...},"description":"..."}]}. ' +
  "Rules: only use tools from the provided list; choose arguments matching each tool's schema; " +
  'keep the sequence to 1-4 steps; if the goal cannot be achieved with the given tools, respond ' +
  '{"steps":[]}.';

function parsePlan(content: string): PlannedStep[] {
  const trimmed = content.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const raw = fenced?.[1] ?? trimmed;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1)) as unknown;
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== 'object') {
    return [];
  }
  const steps = (parsed as { steps?: unknown }).steps;
  if (!Array.isArray(steps)) {
    return [];
  }
  return steps
    .filter(
      (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object',
    )
    .map((entry) => {
      const toolName = typeof entry.toolName === 'string' ? entry.toolName.trim() : '';
      const args = entry.args;
      const description = typeof entry.description === 'string' ? entry.description : '';
      if (!toolName || args === null || typeof args !== 'object' || Array.isArray(args)) {
        return null;
      }
      return { toolName, args: args as Record<string, unknown>, description };
    })
    .filter((entry): entry is PlannedStep => entry !== null)
    .slice(0, MAX_PLAN_STEPS);
}

/**
 * LLM-backed task planner. Asks the model to decompose a goal into a tool
 * sequence and validates the result against the registered tool registry.
 */
export function createLLMPlanner(options: {
  runCompletion(request: LLMChatRequest): Promise<{ content: string }>;
  getTools(): Tool[];
}): TaskPlanner {
  return {
    async plan(input): Promise<PlannedStep[]> {
      const tools = options.getTools();
      const toolList = tools
        .map(
          (tool) =>
            `- ${tool.name}: ${tool.description}` +
            (tool.requireConfirmation ? ' (requires user confirmation before it runs)' : ''),
        )
        .join('\n');
      const result = await options.runCompletion({
        messages: [
          { role: 'system', content: PLANNER_SYSTEM_PROMPT },
          {
            role: 'user',
            content: `Available tools:\n${toolList}\n\nGoal: ${input.goal}\n\nPlan:`,
          },
        ],
        temperature: 0.2,
        maxTokens: 800,
      });
      const available = new Set(tools.map((tool) => tool.name));
      return parsePlan(result.content).filter((step) => available.has(step.toolName));
    },
  };
}

/**
 * Tries the LLM planner first and falls back to the deterministic heuristic
 * planner when the model is unreachable or yields no usable plan.
 */
export function createFallbackPlanner(options: {
  runCompletion(request: LLMChatRequest): Promise<{ content: string }>;
  getTools(): Tool[];
}): TaskPlanner {
  const llm = createLLMPlanner(options);
  const heuristic = createHeuristicPlanner(options);
  return {
    async plan(input): Promise<PlannedStep[]> {
      try {
        const steps = await llm.plan(input);
        if (steps.length > 0) {
          return steps;
        }
      } catch {
        // Fall back to the heuristic planner.
      }
      return heuristic.plan(input);
    },
  };
}

import type { Tool } from '../tools/types.js';
import type { PlannedStep, StepExecutionResult, ToolExecutor } from './types.js';

/**
 * Executes a single planned step against the real tool registry. Confirmation
 * required tools are NOT executed here — they surface a summary so the engine
 * can pause for the user's approval.
 */
export function createToolExecutor(options: {
  getTool(name: string): Tool | undefined;
  validateOutput(input: unknown): string;
  describeAction(toolName: string, args: Record<string, unknown>): string;
}): ToolExecutor {
  return {
    async runStepOnce(
      step: PlannedStep,
      context: { userId: string },
    ): Promise<StepExecutionResult> {
      const tool = options.getTool(step.toolName);
      if (!tool) {
        return {
          needsConfirmation: false,
          ok: false,
          output: `Error: unknown tool "${step.toolName}"`,
        };
      }
      if (tool.requireConfirmation) {
        return { needsConfirmation: true, summary: options.describeAction(tool.name, step.args) };
      }
      try {
        const output = options.validateOutput(await tool.execute(step.args, context));
        return { needsConfirmation: false, ok: true, output };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { needsConfirmation: false, ok: false, output: `Error: ${message}` };
      }
    },
  };
}

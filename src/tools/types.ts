export type ToolParameterSchema = {
  type: 'object';
  properties: Record<string, { type: string; description?: string }>;
  required?: string[];
  additionalProperties?: boolean;
};

export type ToolContext = {
  userId: string;
};

export interface Tool {
  name: string;
  description: string;
  parameters: ToolParameterSchema;
  /**
   * When true, the tool's output is already a complete, user-ready answer and
   * the chat skips the follow-up model round that would restate it. Use for
   * tools whose result needs no reformatting (e.g. current time).
   */
  answerFinal?: boolean;
  execute(args: Record<string, unknown>, context: ToolContext): Promise<string> | string;
}

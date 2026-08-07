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
   * The integration provider this tool acts on (e.g. `google-gmail`), when the
   * tool requires a per-user connection. Used by the AI-awareness layer to tell
   * the model which accounts are connected and to surface a Connect button.
   */
  providerId?: string;
  /**
   * When true, the tool's output is already a complete, user-ready answer and
   * the chat skips the follow-up model round that would restate it. Use for
   * tools whose result needs no reformatting (e.g. current time).
   */
  answerFinal?: boolean;
  /**
   * When true, the chat route does not execute the tool directly. It creates a
   * pending action and asks the user for explicit confirmation first (via the
   * confirmation API). Use for destructive or privileged OS actions (e.g.
   * deleting files, running shell commands).
   */
  requireConfirmation?: boolean;
  execute(args: Record<string, unknown>, context: ToolContext): Promise<string> | string;
}

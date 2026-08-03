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
  execute(args: Record<string, unknown>, context: ToolContext): Promise<string> | string;
}

import type { Tool } from './types.js';

export const currentTimeTool: Tool = {
  name: 'get_current_time',
  description:
    'Return the current date and time in UTC as an ISO 8601 string. Use this whenever the user asks what time it is or what the current date is.',
  parameters: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  execute() {
    return new Date().toISOString();
  },
};

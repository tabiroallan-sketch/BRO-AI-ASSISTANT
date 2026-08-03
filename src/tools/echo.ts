import type { Tool } from './types.js';

export const echoTool: Tool = {
  name: 'echo',
  description: 'Return the given text unchanged. Useful for verifying tool calling.',
  parameters: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'The text to echo back.' },
    },
    required: ['text'],
  },
  execute(args) {
    const text = args.text;
    return typeof text === 'string' ? text : String(text ?? '');
  },
};

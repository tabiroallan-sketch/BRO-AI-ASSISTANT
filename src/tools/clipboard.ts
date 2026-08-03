import type { Tool } from './types.js';

const clipboards = new Map<string, string>();

export const clipboardTool: Tool = {
  name: 'clipboard',
  description:
    'Store and retrieve short text snippets in the user\'s private clipboard. Operations: "copy" (save text), "paste" (retrieve the last copied text) and "clear". Use this to hold temporary snippets across a conversation.',
  parameters: {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        description: 'One of: copy, paste, clear.',
      },
      text: {
        type: 'string',
        description: 'Text to store (only used with the "copy" operation).',
      },
    },
    required: ['operation'],
  },
  execute(args, context) {
    const operation = typeof args.operation === 'string' ? args.operation : '';
    switch (operation) {
      case 'copy': {
        const text = typeof args.text === 'string' ? args.text : '';
        clipboards.set(context.userId, text);
        return `Copied ${text.length} characters to clipboard.`;
      }
      case 'paste': {
        const text = clipboards.get(context.userId);
        return text === undefined ? 'Clipboard is empty.' : text;
      }
      case 'clear': {
        clipboards.delete(context.userId);
        return 'Clipboard cleared.';
      }
      default:
        throw new Error(`Unknown clipboard operation "${operation}"`);
    }
  },
};

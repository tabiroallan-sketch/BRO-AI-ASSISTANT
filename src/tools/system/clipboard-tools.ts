import type { Tool } from '../types.js';
import { clipboardOps } from './ops.js';

export const systemReadClipboardTool: Tool = {
  name: 'system_read_clipboard',
  description:
    "Read the current text from the computer's OS clipboard (the real clipboard shared by all applications, not BRO's in-conversation clipboard). Returns up to 10000 characters. Non-destructive; no confirmation needed.",
  parameters: {
    type: 'object',
    properties: {
      maxChars: {
        type: 'number',
        description: 'Maximum characters to return (default 10000).',
      },
    },
  },
  async execute(args) {
    const maxChars = typeof args.maxChars === 'number' ? args.maxChars : undefined;
    return clipboardOps.readOsClipboard(maxChars);
  },
};

export const systemWriteClipboardTool: Tool = {
  name: 'system_write_clipboard',
  description:
    "Copy text to the computer's OS clipboard (the real clipboard shared by all applications). Non-destructive; no confirmation needed.",
  parameters: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'The text to copy to the clipboard.' },
    },
    required: ['text'],
  },
  async execute(args) {
    const text = typeof args.text === 'string' ? args.text : '';
    return clipboardOps.writeOsClipboard(text);
  },
};

import { redactText } from './secrets.js';

export const MAX_ASSISTANT_OUTPUT = 20000;
export const MAX_TOOL_OUTPUT = 20000;

const CONTROL_CHARACTERS = new RegExp(
  `[${String.fromCharCode(0x00)}-${String.fromCharCode(0x08)}${String.fromCharCode(0x0b)}${String.fromCharCode(0x0c)}${String.fromCharCode(0x0e)}-${String.fromCharCode(0x1f)}${String.fromCharCode(0x7f)}]`,
  'g',
);

function stripControlCharacters(text: string): string {
  return text.replace(CONTROL_CHARACTERS, '');
}

export function sanitizeOutputText(input: unknown): string {
  const text = typeof input === 'string' ? input : String(input ?? '');
  const cleaned = stripControlCharacters(text);
  const truncated =
    cleaned.length > MAX_ASSISTANT_OUTPUT ? cleaned.slice(0, MAX_ASSISTANT_OUTPUT) : cleaned;
  return redactText(truncated);
}

export function validateToolOutput(input: unknown): string {
  const text = typeof input === 'string' ? input : String(input ?? '');
  const cleaned = stripControlCharacters(text);
  const truncated =
    cleaned.length > MAX_TOOL_OUTPUT
      ? `${cleaned.slice(0, MAX_TOOL_OUTPUT)}… [truncated]`
      : cleaned;
  return redactText(truncated);
}

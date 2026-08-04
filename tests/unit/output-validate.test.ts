import { describe, expect, it, beforeEach } from 'vitest';
import {
  MAX_ASSISTANT_OUTPUT,
  MAX_TOOL_OUTPUT,
  sanitizeOutputText,
  validateToolOutput,
} from '../../src/lib/output-validate.js';
import { registerSecret } from '../../src/lib/secrets.js';

describe('output validation and sanitization', () => {
  beforeEach(() => {
    registerSecret('unit-output-validate-secret', 'unit-output-validate-secret');
  });

  it('strips control characters', () => {
    const dirty = `line1\x00\x07\x1f\x7fline2`;
    expect(sanitizeOutputText(dirty)).toBe('line1line2');
  });

  it('coerces non-string input to text', () => {
    expect(sanitizeOutputText(12345)).toBe('12345');
    expect(sanitizeOutputText(null)).toBe('');
    expect(sanitizeOutputText(undefined)).toBe('');
  });

  it('truncates assistant output to the limit', () => {
    const long = 'a'.repeat(MAX_ASSISTANT_OUTPUT + 500);
    const result = sanitizeOutputText(long);
    expect(result.length).toBe(MAX_ASSISTANT_OUTPUT);
  });

  it('truncates tool output with an explicit marker', () => {
    const long = 'b'.repeat(MAX_TOOL_OUTPUT + 100);
    const result = validateToolOutput(long);
    expect(result.length).toBe(MAX_TOOL_OUTPUT + '… [truncated]'.length);
    expect(result.endsWith('… [truncated]')).toBe(true);
  });

  it('redacts registered secrets', () => {
    const result = sanitizeOutputText('the password is unit-output-validate-secret end');
    expect(result).toContain('[REDACTED]');
    expect(result).not.toContain('unit-output-validate-secret');
  });

  it('does not truncate short tool output', () => {
    expect(validateToolOutput('short')).toBe('short');
  });
});

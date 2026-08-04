import { describe, expect, it } from 'vitest';
import { definePlugin, validatePluginManifest } from '../../src/plugins/manifest.js';

describe('plugin manifest validation', () => {
  it('accepts a valid manifest', () => {
    const result = validatePluginManifest({
      name: 'hello',
      version: '1.0.0',
      description: 'A plugin',
      tools: [
        {
          name: 'hello_tool',
          description: 'Say hello',
          parameters: { type: 'object', properties: {} },
          execute: () => 'hello',
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifest.name).toBe('hello');
      expect(result.manifest.tools).toHaveLength(1);
    }
  });

  it('rejects a manifest missing version', () => {
    const result = validatePluginManifest({ name: 'hello' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/version/i);
    }
  });

  it('rejects a manifest missing name', () => {
    const result = validatePluginManifest({ version: '1.0.0' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/name/i);
    }
  });

  it('rejects a tool without an execute function', () => {
    const result = validatePluginManifest({
      name: 'hello',
      version: '1.0.0',
      tools: [
        {
          name: 'broken_tool',
          description: 'Broken',
          parameters: { type: 'object', properties: {} },
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/execute/i);
    }
  });

  it('rejects an empty name', () => {
    const result = validatePluginManifest({ name: '', version: '1.0.0' });
    expect(result.ok).toBe(false);
  });

  it('passes a manifest through definePlugin', () => {
    const plugin = definePlugin({ name: 'hello', version: '1.0.0' });
    expect(plugin).toEqual({ name: 'hello', version: '1.0.0' });
  });
});

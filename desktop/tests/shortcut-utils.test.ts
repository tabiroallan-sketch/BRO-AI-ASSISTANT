import { describe, expect, it } from 'vitest';
import {
  findConflicts,
  isDisabled,
  normalizeAccelerator,
  validateAccelerator,
} from '../src/main/shortcut-utils.js';
import type { ShortcutBindings } from '../src/shared/desktop-api.js';

describe('normalizeAccelerator', () => {
  it('canonicalizes modifier aliases', () => {
    expect(normalizeAccelerator('Ctrl+Shift+B')).toBe('Control+Shift+B');
    expect(normalizeAccelerator('CmdOrCtrl+Shift+B')).toBe('CommandOrControl+Shift+B');
    expect(normalizeAccelerator('control+shift+b')).toBe('Control+Shift+B');
  });

  it('orders modifiers canonically', () => {
    expect(normalizeAccelerator('Shift+Ctrl+A')).toBe('Control+Shift+A');
    expect(normalizeAccelerator('A+Ctrl')).toBe('Control+A');
  });

  it('maps key aliases', () => {
    expect(normalizeAccelerator('Esc')).toBe('Escape');
    expect(normalizeAccelerator('Ctrl+Spacebar')).toBe('Control+Space');
    expect(normalizeAccelerator('Alt+ArrowUp')).toBe('Alt+Up');
  });

  it('uppercases single letters', () => {
    expect(normalizeAccelerator('ctrl+shift+m')).toBe('Control+Shift+M');
  });

  it('returns empty for junk', () => {
    expect(normalizeAccelerator('+++')).toBe('');
  });
});

describe('validateAccelerator', () => {
  it('accepts a modifier + key combo', () => {
    expect(validateAccelerator('CommandOrControl+Space').ok).toBe(true);
  });

  it('accepts a lone key like Escape', () => {
    expect(validateAccelerator('Escape').ok).toBe(true);
  });

  it('rejects modifier-only accelerators (OS cannot register them)', () => {
    expect(validateAccelerator('Alt').ok).toBe(false);
    expect(validateAccelerator('Ctrl+Shift').ok).toBe(false);
  });

  it('rejects empty input', () => {
    expect(validateAccelerator('').ok).toBe(false);
    expect(validateAccelerator('   ').ok).toBe(false);
  });

  it('rejects multiple keys', () => {
    expect(validateAccelerator('Ctrl+A+B').ok).toBe(false);
  });

  it('returns the normalized accelerator on success', () => {
    const result = validateAccelerator('ctrl+shift+m');
    expect(result.ok && result.accelerator).toBe('Control+Shift+M');
  });
});

describe('findConflicts', () => {
  const bindings = (overrides: Partial<ShortcutBindings>): ShortcutBindings => ({
    'open-overlay': 'CommandOrControl+Space',
    'hide-overlay': 'Escape',
    'push-to-talk': 'Alt+P',
    'open-dashboard': 'CommandOrControl+Shift+B',
    'toggle-mic': 'CommandOrControl+Shift+M',
    ...overrides,
  });

  it('reports duplicate normalized accelerators', () => {
    const conflicts = findConflicts(
      bindings({ 'hide-overlay': 'Escape', 'open-dashboard': 'esc' }),
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      action: 'open-dashboard',
      conflictsWith: 'hide-overlay',
    });
  });

  it('ignores disabled bindings', () => {
    const conflicts = findConflicts(
      bindings({ 'toggle-mic': '', 'open-dashboard': 'CommandOrControl+Shift+M' }),
    );
    expect(conflicts).toHaveLength(0);
  });

  it('ignores alias/order variations', () => {
    const conflicts = findConflicts(bindings({ 'toggle-mic': 'Ctrl+Shift+B' }));
    expect(conflicts).toHaveLength(0);
  });
});

describe('isDisabled', () => {
  it('treats empty and whitespace as disabled', () => {
    expect(isDisabled('')).toBe(true);
    expect(isDisabled('   ')).toBe(true);
  });

  it('treats a real accelerator as enabled', () => {
    expect(isDisabled('Control+Shift+M')).toBe(false);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { ShortcutRegistry } from '../src/main/shortcuts.js';

describe('ShortcutRegistry', () => {
  it('registers accelerators and forwards triggers by id', () => {
    const onTriggered = vi.fn();
    const registry = new ShortcutRegistry({
      onTriggered,
      registerFn: vi.fn().mockReturnValue(true),
      isRegisteredFn: vi.fn().mockReturnValue(true),
    });
    expect(registry.registerOne({ id: 'mic', accelerator: 'Ctrl+Shift+M' })).toBe(true);
    registry['callbacks'].get('mic')!();
    expect(onTriggered).toHaveBeenCalledWith('mic');
  });

  it('replaces an accelerator for the same id', () => {
    const onTriggered = vi.fn();
    const register = vi.fn().mockReturnValue(true);
    const unregister = vi.fn();
    const registry = new ShortcutRegistry({
      onTriggered,
      registerFn: register,
      unregisterFn: unregister,
    });
    registry.registerOne({ id: 'mic', accelerator: 'Ctrl+Shift+M' });
    registry.registerOne({ id: 'mic', accelerator: 'Ctrl+Alt+M' });
    expect(unregister).toHaveBeenCalledWith('Ctrl+Shift+M');
    expect(register).toHaveBeenLastCalledWith('Ctrl+Alt+M', expect.any(Function));
    expect(registry.registeredAccelerators).toEqual(['Ctrl+Alt+M']);
  });

  it('does not unregister when the accelerator is unchanged', () => {
    const onTriggered = vi.fn();
    const register = vi.fn().mockReturnValue(true);
    const unregister = vi.fn();
    const registry = new ShortcutRegistry({
      onTriggered,
      registerFn: register,
      unregisterFn: unregister,
    });
    registry.registerOne({ id: 'mic', accelerator: 'Ctrl+Shift+M' });
    registry.registerOne({ id: 'mic', accelerator: 'Ctrl+Shift+M' });
    expect(unregister).not.toHaveBeenCalled();
  });

  it('reports failed registrations', () => {
    const registry = new ShortcutRegistry({
      onTriggered: vi.fn(),
      registerFn: () => false,
      isRegisteredFn: () => false,
    });
    expect(registry.registerOne({ id: 'mic', accelerator: 'Ctrl+Shift+M' })).toBe(false);
    expect(registry.isRegistered('mic')).toBe(false);
  });

  it('unregisters all tracked shortcuts', () => {
    const unregister = vi.fn();
    const registry = new ShortcutRegistry({
      onTriggered: vi.fn(),
      registerFn: () => true,
      unregisterFn: unregister,
    });
    registry.registerOne({ id: 'a', accelerator: 'Ctrl+A' });
    registry.registerOne({ id: 'b', accelerator: 'Ctrl+B' });
    registry.unregisterAll();
    expect(unregister).toHaveBeenCalledWith('Ctrl+A');
    expect(unregister).toHaveBeenCalledWith('Ctrl+B');
    expect(registry.registeredAccelerators).toEqual([]);
  });
});

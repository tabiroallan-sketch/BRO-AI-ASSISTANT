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

  it('treats re-registering the same accelerator as success without work', () => {
    const register = vi.fn().mockReturnValue(true);
    const unregister = vi.fn();
    const registry = new ShortcutRegistry({
      onTriggered: vi.fn(),
      registerFn: register,
      unregisterFn: unregister,
    });
    registry.registerOne({ id: 'mic', accelerator: 'Ctrl+Shift+M' });
    expect(registry.registerOne({ id: 'mic', accelerator: 'Ctrl+Shift+M' })).toBe(true);
    expect(register).toHaveBeenCalledTimes(1);
    expect(unregister).not.toHaveBeenCalled();
  });

  it('catches a throwing register function instead of crashing', () => {
    const registry = new ShortcutRegistry({
      onTriggered: vi.fn(),
      registerFn: () => {
        throw new Error('invalid accelerator');
      },
    });
    expect(registry.registerOne({ id: 'mic', accelerator: 'Alt' })).toBe(false);
    expect(registry.isRegistered('mic')).toBe(false);
  });

  it('configure applies bindings and skips disabled ones', () => {
    const register = vi.fn().mockReturnValue(true);
    const unregister = vi.fn();
    const registry = new ShortcutRegistry({
      onTriggered: vi.fn(),
      registerFn: register,
      unregisterFn: unregister,
    });
    const results = registry.configure({
      'open-overlay': 'Ctrl+Space',
      'hide-overlay': '',
      'toggle-mic': 'Ctrl+Shift+M',
    });
    expect(results).toEqual({ 'open-overlay': true, 'hide-overlay': true, 'toggle-mic': true });
    expect(register).toHaveBeenCalledTimes(2);
    expect(registry.getBindings()).toEqual({
      'open-overlay': 'Ctrl+Space',
      'hide-overlay': '',
      'toggle-mic': 'Ctrl+Shift+M',
    });
    registry.unregisterAll();
    expect(unregister).toHaveBeenCalledWith('Ctrl+Space');
    expect(unregister).toHaveBeenCalledWith('Ctrl+Shift+M');
  });

  it('configure reports failed registrations per id', () => {
    const registry = new ShortcutRegistry({
      onTriggered: vi.fn(),
      registerFn: (accelerator: string) => accelerator === 'Ctrl+A',
    });
    const results = registry.configure({ a: 'Ctrl+A', b: 'Ctrl+B' });
    expect(results).toEqual({ a: true, b: false });
  });

  it('setBinding can enable and disable an action', () => {
    const register = vi.fn().mockReturnValue(true);
    const unregister = vi.fn();
    const registry = new ShortcutRegistry({
      onTriggered: vi.fn(),
      registerFn: register,
      unregisterFn: unregister,
    });
    expect(registry.setBinding('mic', 'Ctrl+Shift+M')).toBe(true);
    expect(registry.getBindings().mic).toBe('Ctrl+Shift+M');
    expect(registry.setBinding('mic', '')).toBe(true);
    expect(unregister).toHaveBeenCalledWith('Ctrl+Shift+M');
    expect(registry.getBindings().mic).toBe('');
  });
});

import { globalShortcut } from 'electron';
import { isDisabled } from './shortcut-utils.js';

export type ShortcutDefinition = {
  /** Stable identifier used by the renderer (tray/menus/settings). */
  id: string;
  /** Electron accelerator string, e.g. "CommandOrControl+Shift+B". */
  accelerator: string;
};

export type ShortcutRegistryOptions = {
  onTriggered: (id: string) => void;
  /** Overridable for tests. */
  registerFn?: (accelerator: string, callback: () => void) => boolean;
  unregisterFn?: (accelerator: string) => void;
  isRegisteredFn?: (accelerator: string) => boolean;
};

/**
 * Global-shortcut registry driving the configurable hotkey system (Stage 3).
 * Bindings come from user config; an empty accelerator disables an action.
 * Registration is defensive (a hostile accelerator never crashes the app) and
 * re-registering an unchanged accelerator is a no-op success.
 */
export class ShortcutRegistry {
  private readonly options: ShortcutRegistryOptions;
  private readonly registered = new Map<string, string>();
  private readonly callbacks = new Map<string, () => void>();
  private readonly bindings = new Map<string, string>();

  constructor(options: ShortcutRegistryOptions) {
    this.options = options;
  }

  get registeredAccelerators(): string[] {
    return [...this.registered.values()];
  }

  /**
   * Applies the full set of bindings: unregisters everything first, then
   * registers each non-disabled action. Returns per-id registration results.
   */
  configure(bindings: Record<string, string>): Record<string, boolean> {
    this.unregisterAll();
    this.bindings.clear();
    const results: Record<string, boolean> = {};
    for (const [id, accelerator] of Object.entries(bindings)) {
      const trimmed = typeof accelerator === 'string' ? accelerator.trim() : '';
      this.bindings.set(id, trimmed);
      if (isDisabled(trimmed)) {
        results[id] = true;
        continue;
      }
      results[id] = this.registerOne({ id, accelerator: trimmed });
    }
    return results;
  }

  /** Current bindings (empty strings are disabled actions). */
  getBindings(): Record<string, string> {
    return Object.fromEntries(this.bindings);
  }

  /** Rebinds a single action. Returns whether the accelerator registered. */
  setBinding(id: string, accelerator: string): boolean {
    const trimmed = typeof accelerator === 'string' ? accelerator.trim() : '';
    this.bindings.set(id, trimmed);
    if (isDisabled(trimmed)) {
      this.unregisterOne(id);
      return true;
    }
    return this.registerOne({ id, accelerator: trimmed });
  }

  register(definitions: ShortcutDefinition[]): void {
    for (const definition of definitions) {
      this.registerOne(definition);
    }
  }

  registerOne(definition: ShortcutDefinition): boolean {
    const registerFn = this.options.registerFn ?? globalShortcut?.register;
    if (!registerFn) {
      return false;
    }
    const existing = this.registered.get(definition.id);
    if (existing === definition.accelerator) {
      return true;
    }
    if (existing !== undefined) {
      this.unregisterOne(definition.id);
    }
    const callback = (): void => this.options.onTriggered(definition.id);
    let ok = false;
    try {
      ok = registerFn(definition.accelerator, callback);
    } catch {
      // A malformed or OS-rejected accelerator must not crash the app.
      ok = false;
    }
    if (ok) {
      this.registered.set(definition.id, definition.accelerator);
      this.callbacks.set(definition.id, callback);
    }
    return ok;
  }

  unregisterOne(id: string): void {
    const unregisterFn = this.options.unregisterFn ?? globalShortcut?.unregister;
    const accelerator = this.registered.get(id);
    if (accelerator) {
      unregisterFn?.(accelerator);
    }
    this.registered.delete(id);
    this.callbacks.delete(id);
  }

  isRegistered(id: string): boolean {
    const isRegisteredFn = this.options.isRegisteredFn ?? globalShortcut?.isRegistered;
    const accelerator = this.registered.get(id);
    if (accelerator === undefined) {
      return false;
    }
    // Without a real Electron binding available (unit tests), fall back to the
    // tracking map instead of crashing.
    return isRegisteredFn ? isRegisteredFn(accelerator) : true;
  }

  unregisterAll(): void {
    for (const id of [...this.registered.keys()]) {
      this.unregisterOne(id);
    }
  }
}

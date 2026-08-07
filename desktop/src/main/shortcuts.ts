import { globalShortcut } from 'electron';

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
 * Baseline global-shortcut registry. Stage 3 turns this into the fully
 * configurable hotkey system (custom accelerators + conflict detection); the
 * registry interface is designed so that work is purely additive.
 */
export class ShortcutRegistry {
  private readonly options: ShortcutRegistryOptions;
  private readonly registered = new Map<string, string>();
  private readonly callbacks = new Map<string, () => void>();

  constructor(options: ShortcutRegistryOptions) {
    this.options = options;
  }

  get registeredAccelerators(): string[] {
    return [...this.registered.values()];
  }

  register(definitions: ShortcutDefinition[]): void {
    for (const definition of definitions) {
      this.registerOne(definition);
    }
  }

  registerOne(definition: ShortcutDefinition): boolean {
    const { registerFn = globalShortcut.register } = this.options;
    const existing = this.registered.get(definition.id);
    if (existing && existing !== definition.accelerator) {
      this.unregisterOne(definition.id);
    }
    const callback = (): void => this.options.onTriggered(definition.id);
    const ok = registerFn(definition.accelerator, callback);
    if (ok) {
      this.registered.set(definition.id, definition.accelerator);
      this.callbacks.set(definition.id, callback);
    }
    return ok;
  }

  unregisterOne(id: string): void {
    const { unregisterFn = globalShortcut.unregister } = this.options;
    const accelerator = this.registered.get(id);
    if (accelerator) {
      unregisterFn(accelerator);
    }
    this.registered.delete(id);
    this.callbacks.delete(id);
  }

  isRegistered(id: string): boolean {
    const { isRegisteredFn = globalShortcut.isRegistered } = this.options;
    const accelerator = this.registered.get(id);
    return accelerator !== undefined && isRegisteredFn(accelerator);
  }

  unregisterAll(): void {
    for (const id of [...this.registered.keys()]) {
      this.unregisterOne(id);
    }
  }
}

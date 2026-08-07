import {
  SHORTCUT_ACTIONS,
  type ShortcutAction,
  type ShortcutBindings,
} from '../shared/desktop-api.js';

const MODIFIER_ALIASES: Record<string, string> = {
  commandorcontrol: 'CommandOrControl',
  cmdorctrl: 'CommandOrControl',
  command: 'Command',
  cmd: 'Command',
  control: 'Control',
  ctrl: 'Control',
  alt: 'Alt',
  option: 'Alt',
  altgr: 'AltGr',
  shift: 'Shift',
  super: 'Super',
  meta: 'Super',
};

/** Canonical display order for modifiers (Electron ignores order). */
const MODIFIER_ORDER = ['CommandOrControl', 'Command', 'Control', 'Alt', 'AltGr', 'Shift', 'Super'];

const KEY_ALIASES: Record<string, string> = {
  esc: 'Escape',
  escape: 'Escape',
  return: 'Enter',
  enter: 'Enter',
  spacebar: 'Space',
  ' ': 'Space',
  up: 'Up',
  down: 'Down',
  left: 'Left',
  right: 'Right',
  arrowup: 'Up',
  arrowdown: 'Down',
  arrowleft: 'Left',
  arrowright: 'Right',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  insert: 'Insert',
  del: 'Delete',
  delete: 'Delete',
  home: 'Home',
  end: 'End',
  tab: 'Tab',
  backspace: 'Backspace',
};

/**
 * Normalizes an accelerator to a canonical form so semantically identical
 * spellings (Ctrl vs Control, CmdOrCtrl vs CommandOrControl, ArrowUp vs Up,
 * modifier ordering) compare equal. Returns '' when nothing usable remains.
 */
export function normalizeAccelerator(raw: string): string {
  const parts = raw
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean);
  const modifiers: string[] = [];
  const keys: string[] = [];
  for (const part of parts) {
    const canonical =
      MODIFIER_ALIASES[part.toLowerCase()] ?? KEY_ALIASES[part.toLowerCase()] ?? part;
    if (MODIFIER_ORDER.includes(canonical)) {
      modifiers.push(canonical);
    } else {
      keys.push(canonical);
    }
  }
  let key = '';
  if (keys.length === 1) {
    const single = keys[0];
    if (single !== undefined) {
      key = single.length === 1 ? single.toUpperCase() : single;
    }
  } else if (keys.length > 1) {
    key = keys.join('+');
  }
  modifiers.sort((a, b) => MODIFIER_ORDER.indexOf(a) - MODIFIER_ORDER.indexOf(b));
  return [...modifiers, key].filter(Boolean).join('+');
}

export type AcceleratorValidation =
  { ok: true; accelerator: string } | { ok: false; reason: string };

/**
 * Validates a raw accelerator string. A valid global shortcut needs exactly
 * one key code plus any modifiers. Modifier-only combos ("Alt" alone) are
 * rejected because the OS will not hand a lone modifier to globalShortcut.
 */
export function validateAccelerator(raw: string): AcceleratorValidation {
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  if (!trimmed) {
    return { ok: false, reason: 'Enter a shortcut.' };
  }
  const normalized = normalizeAccelerator(trimmed);
  if (!normalized) {
    return { ok: false, reason: 'No usable key was recognized.' };
  }
  const keys = normalized.split('+').filter((part) => !MODIFIER_ORDER.includes(part));
  if (keys.length === 0) {
    return {
      ok: false,
      reason: 'A shortcut needs a key. The OS does not allow a modifier alone.',
    };
  }
  if (keys.length > 1) {
    return { ok: false, reason: 'A shortcut can only have one key.' };
  }
  return { ok: true, accelerator: normalized };
}

export type BindingConflict = {
  action: ShortcutAction;
  accelerator: string;
  conflictsWith: ShortcutAction;
};

/**
 * Returns every binding that collides with an earlier one (same normalized
 * accelerator). Disabled bindings (empty string) are ignored.
 */
export function findConflicts(bindings: ShortcutBindings): BindingConflict[] {
  const seen = new Map<string, ShortcutAction>();
  const conflicts: BindingConflict[] = [];
  for (const action of SHORTCUT_ACTIONS) {
    const accelerator = bindings[action];
    if (!accelerator) {
      continue;
    }
    const normalized = normalizeAccelerator(accelerator);
    if (!normalized) {
      continue;
    }
    const prior = seen.get(normalized);
    if (prior) {
      conflicts.push({ action, accelerator, conflictsWith: prior });
    } else {
      seen.set(normalized, action);
    }
  }
  return conflicts;
}

/** True when the binding is empty (disabled). */
export function isDisabled(accelerator: string): boolean {
  return typeof accelerator !== 'string' || accelerator.trim() === '';
}

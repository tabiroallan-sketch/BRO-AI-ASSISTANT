import { describe, expect, it } from 'vitest';
import { acceleratorFromEvent, formatAccelerator } from '@/lib/desktop';

function keyEvent(partial: Partial<KeyboardEvent>): KeyboardEvent {
  return {
    key: '',
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...partial,
  } as KeyboardEvent;
}

describe('formatAccelerator', () => {
  it('formats a modifier + key combo', () => {
    expect(formatAccelerator('CommandOrControl+Shift+B')).toBe('Ctrl/⌘ + Shift + B');
  });

  it('renders a lone key', () => {
    expect(formatAccelerator('Escape')).toBe('Escape');
  });

  it('renders disabled for an empty binding', () => {
    expect(formatAccelerator('')).toBe('Disabled');
  });
});

describe('acceleratorFromEvent', () => {
  it('builds a combo from modifiers and a key', () => {
    const accelerator = acceleratorFromEvent(keyEvent({ key: 'b', ctrlKey: true, shiftKey: true }));
    expect(accelerator).toBe('CommandOrControl+Shift+B');
  });

  it('maps space to Space', () => {
    expect(acceleratorFromEvent(keyEvent({ key: ' ', ctrlKey: true }))).toBe(
      'CommandOrControl+Space',
    );
  });

  it('maps Escape to Escape', () => {
    expect(acceleratorFromEvent(keyEvent({ key: 'Escape' }))).toBe('Escape');
  });

  it('maps arrow keys to Electron names', () => {
    expect(acceleratorFromEvent(keyEvent({ key: 'ArrowUp', altKey: true }))).toBe('Alt+Up');
  });

  it('returns empty while only a modifier is pressed', () => {
    expect(acceleratorFromEvent(keyEvent({ key: 'Control' }))).toBe('');
    expect(acceleratorFromEvent(keyEvent({ key: 'Shift', ctrlKey: true }))).toBe('');
  });

  it('returns empty for unprintable keys', () => {
    expect(acceleratorFromEvent(keyEvent({ key: 'Dead' }))).toBe('');
  });
});

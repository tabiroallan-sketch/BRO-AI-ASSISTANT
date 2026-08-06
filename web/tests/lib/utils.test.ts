import { describe, expect, it } from 'vitest';
import { cn } from '@/lib/utils';

describe('cn', () => {
  it('merges conditional class names and filters falsy values', () => {
    expect(cn('a', 'b')).toBe('a b');
    expect(cn('a', false, undefined, null, '', 'b')).toBe('a b');
    expect(cn()).toBe('');
  });

  it('resolves tailwind conflicts in favor of the last class', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4');
    expect(cn('py-1', 'py-3')).toBe('py-3');
    expect(cn('text-red-500', 'text-blue-600')).toBe('text-blue-600');
    expect(cn('bg-red-500', 'bg-blue-600', 'text-white')).toBe('bg-blue-600 text-white');
  });

  it('keeps non-conflicting utilities together', () => {
    expect(cn('flex', 'items-center', 'px-2')).toBe('flex items-center px-2');
  });
});

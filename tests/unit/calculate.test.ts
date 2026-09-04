import { describe, expect, it } from 'vitest';
import { evaluateExpression } from '../../src/tools/calculate.js';
import { calculateTool } from '../../src/tools/calculate.js';

describe('expression evaluator', () => {
  it('evaluates arithmetic', () => {
    expect(evaluateExpression('1 + 2')).toBe(3);
    expect(evaluateExpression('10 - 4')).toBe(6);
    expect(evaluateExpression('6 * 7')).toBe(42);
    expect(evaluateExpression('1 + 2 * 3')).toBe(7);
  });

  it('respects parentheses and precedence', () => {
    expect(evaluateExpression('(1 + 2) * 3')).toBe(9);
    expect(evaluateExpression('2 + 3 * 4 - 1')).toBe(13);
  });

  it('supports unary minus and plus', () => {
    expect(evaluateExpression('-5 + 3')).toBe(-2);
    expect(evaluateExpression('2 - -3')).toBe(5);
    expect(evaluateExpression('+7')).toBe(7);
  });

  it('supports power with right associativity', () => {
    expect(evaluateExpression('2 ^ 3')).toBe(8);
    expect(evaluateExpression('2 ^ 3 ^ 2')).toBe(512);
  });

  it('supports modulo and division', () => {
    expect(evaluateExpression('10 % 3')).toBe(1);
    expect(evaluateExpression('9 / 4')).toBe(2.25);
  });

  it('supports constants', () => {
    expect(evaluateExpression('pi')).toBeCloseTo(Math.PI);
    expect(evaluateExpression('e')).toBeCloseTo(Math.E);
  });

  it('supports functions', () => {
    expect(evaluateExpression('sqrt(9)')).toBe(3);
    expect(evaluateExpression('pow(2, 10)')).toBe(1024);
    expect(evaluateExpression('max(1, 5, 3)')).toBe(5);
    expect(evaluateExpression('min(2, 8)')).toBe(2);
    expect(evaluateExpression('round(3.7)')).toBe(4);
  });

  it('throws on division by zero', () => {
    expect(() => evaluateExpression('1 / 0')).toThrow('Division by zero');
    expect(() => evaluateExpression('1 % 0')).toThrow('Division by zero');
  });

  it('throws on unknown functions and constants', () => {
    expect(() => evaluateExpression('foo(2)')).toThrow('Unknown function "foo"');
    expect(() => evaluateExpression('xyz')).toThrow('Unknown constant "xyz"');
  });

  it('throws on malformed expressions', () => {
    expect(() => evaluateExpression('')).toThrow('Empty expression');
    expect(() => evaluateExpression('(1 + 2')).toThrow();
    expect(() => evaluateExpression('1 +')).toThrow();
    expect(() => evaluateExpression('1 2')).toThrow('Unexpected trailing characters');
    expect(() => evaluateExpression('1..2')).toThrow('Invalid number');
    expect(() => evaluateExpression('a + @')).toThrow('Unexpected character');
  });

  it('exposes a calculate tool that returns string results', () => {
    const ctx = { userId: 'u1' };
    expect(calculateTool.execute({ expression: '2 + 2' }, ctx)).toBe('4');
    expect(() => calculateTool.execute({ expression: '1 / 0' }, ctx)).toThrow('Division by zero');
  });
});

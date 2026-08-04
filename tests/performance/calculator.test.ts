import { describe, expect, it } from 'vitest';
import { evaluateExpression } from '../../src/tools/calculate.js';

const EXPRESSIONS = [
  '1 + 2 * 3',
  '(8 + 4) / 2 - 1',
  'sqrt(pi * 9) + max(2, 5, 8)',
  'pow(2, 8) % 7',
  '-5 + 3 * 4 ^ 2 / 2',
  'round(sin(pi / 2) * 100) / 100',
  'min(4, 2, 9) * max(1, 3)',
  'e ^ 2 + 1',
];

describe('expression evaluator throughput', () => {
  it('evaluates 20k mixed expressions quickly', { retry: 2 }, () => {
    const iterations = 20_000;
    const start = performance.now();
    let checksum = 0;
    for (let index = 0; index < iterations; index += 1) {
      const expression = EXPRESSIONS[index % EXPRESSIONS.length] ?? '1 + 1';
      checksum += evaluateExpression(expression);
    }
    const elapsed = performance.now() - start;
    expect(Number.isFinite(checksum)).toBe(true);
    expect(elapsed).toBeLessThan(3000);
  });
});

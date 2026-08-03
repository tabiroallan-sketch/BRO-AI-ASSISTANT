import type { Tool } from './types.js';

type Token =
  | { kind: 'number'; value: string }
  | { kind: 'ident'; value: string }
  | { kind: 'op'; value: string }
  | { kind: 'lparen' }
  | { kind: 'rparen' }
  | { kind: 'comma' };

const CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  e: Math.E,
};

type MathFunction = {
  fn: (...args: number[]) => number;
  minArgs: number;
  maxArgs: number;
};

const FUNCTIONS: Record<string, MathFunction> = {
  sqrt: { fn: Math.sqrt, minArgs: 1, maxArgs: 1 },
  abs: { fn: Math.abs, minArgs: 1, maxArgs: 1 },
  round: { fn: Math.round, minArgs: 1, maxArgs: 1 },
  floor: { fn: Math.floor, minArgs: 1, maxArgs: 1 },
  ceil: { fn: Math.ceil, minArgs: 1, maxArgs: 1 },
  sin: { fn: Math.sin, minArgs: 1, maxArgs: 1 },
  cos: { fn: Math.cos, minArgs: 1, maxArgs: 1 },
  tan: { fn: Math.tan, minArgs: 1, maxArgs: 1 },
  asin: { fn: Math.asin, minArgs: 1, maxArgs: 1 },
  acos: { fn: Math.acos, minArgs: 1, maxArgs: 1 },
  atan: { fn: Math.atan, minArgs: 1, maxArgs: 1 },
  atan2: { fn: Math.atan2, minArgs: 2, maxArgs: 2 },
  sinh: { fn: Math.sinh, minArgs: 1, maxArgs: 1 },
  cosh: { fn: Math.cosh, minArgs: 1, maxArgs: 1 },
  tanh: { fn: Math.tanh, minArgs: 1, maxArgs: 1 },
  exp: { fn: Math.exp, minArgs: 1, maxArgs: 1 },
  ln: { fn: Math.log, minArgs: 1, maxArgs: 1 },
  log: { fn: Math.log10, minArgs: 1, maxArgs: 1 },
  log2: { fn: Math.log2, minArgs: 1, maxArgs: 1 },
  pow: { fn: Math.pow, minArgs: 2, maxArgs: 2 },
  min: { fn: Math.min, minArgs: 1, maxArgs: 16 },
  max: { fn: Math.max, minArgs: 1, maxArgs: 16 },
};

function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < expression.length) {
    const char = expression[index];
    if (char === undefined) {
      break;
    }
    if (char === ' ' || char === '\t') {
      index += 1;
      continue;
    }
    if (/[0-9.]/.test(char)) {
      let end = index;
      while (end < expression.length) {
        const current = expression[end];
        if (current === undefined || !/[0-9.]/.test(current)) {
          break;
        }
        end += 1;
      }
      const text = expression.slice(index, end);
      if (!/^\d+(\.\d+)?$/.test(text)) {
        throw new Error(`Invalid number "${text}"`);
      }
      tokens.push({ kind: 'number', value: text });
      index = end;
      continue;
    }
    if (/[a-zA-Z_]/.test(char)) {
      let end = index;
      while (end < expression.length) {
        const current = expression[end];
        if (current === undefined || !/[a-zA-Z0-9_]/.test(current)) {
          break;
        }
        end += 1;
      }
      tokens.push({ kind: 'ident', value: expression.slice(index, end).toLowerCase() });
      index = end;
      continue;
    }
    if ('+-*/%^'.includes(char)) {
      tokens.push({ kind: 'op', value: char });
      index += 1;
      continue;
    }
    if (char === '(') {
      tokens.push({ kind: 'lparen' });
      index += 1;
      continue;
    }
    if (char === ')') {
      tokens.push({ kind: 'rparen' });
      index += 1;
      continue;
    }
    if (char === ',') {
      tokens.push({ kind: 'comma' });
      index += 1;
      continue;
    }
    throw new Error(`Unexpected character "${char}"`);
  }
  return tokens;
}

export function evaluateExpression(expression: string): number {
  const tokens = tokenize(expression);
  if (tokens.length === 0) {
    throw new Error('Empty expression');
  }

  let position = 0;

  function peek(): Token | undefined {
    return tokens[position];
  }

  function consume(): Token | undefined {
    return tokens[position++];
  }

  function expectRparen(): void {
    const closing = consume();
    if (!closing || closing.kind !== 'rparen') {
      throw new Error('Unbalanced parentheses');
    }
  }

  function parseFunctionCall(name: string): number {
    consume();
    const args: number[] = [];
    if (peek()?.kind === 'rparen') {
      consume();
    } else {
      for (;;) {
        args.push(parseAdditive());
        const separator = consume();
        if (!separator) {
          throw new Error('Unbalanced parentheses');
        }
        if (separator.kind === 'rparen') {
          break;
        }
        if (separator.kind !== 'comma') {
          throw new Error('Expected "," or ")" in function call');
        }
      }
    }
    const fn = FUNCTIONS[name];
    if (!fn) {
      throw new Error(`Unknown function "${name}"`);
    }
    if (args.length < fn.minArgs || args.length > fn.maxArgs) {
      throw new Error(
        `Function "${name}" expects ${fn.minArgs === fn.maxArgs ? fn.minArgs : `${fn.minArgs} to ${fn.maxArgs}`} argument(s), got ${args.length}`,
      );
    }
    return fn.fn(...args);
  }

  function parsePrimary(): number {
    const token = consume();
    if (!token) {
      throw new Error('Unexpected end of expression');
    }
    if (token.kind === 'number') {
      return Number(token.value);
    }
    if (token.kind === 'ident') {
      if (peek()?.kind === 'lparen') {
        return parseFunctionCall(token.value);
      }
      const constant = CONSTANTS[token.value];
      if (constant === undefined) {
        throw new Error(`Unknown constant "${token.value}"`);
      }
      return constant;
    }
    if (token.kind === 'op' && (token.value === '-' || token.value === '+')) {
      const operand = parsePrimary();
      return token.value === '-' ? -operand : operand;
    }
    if (token.kind === 'lparen') {
      const value = parseAdditive();
      expectRparen();
      return value;
    }
    throw new Error(`Unexpected token "${token.kind === 'op' ? token.value : ')'}"`);
  }

  function parsePower(): number {
    const left = parsePrimary();
    const token = peek();
    if (token?.kind === 'op' && token.value === '^') {
      consume();
      const right = parsePower();
      return left ** right;
    }
    return left;
  }

  function parseTerm(): number {
    let left = parsePower();
    for (;;) {
      const token = peek();
      if (
        token?.kind === 'op' &&
        (token.value === '*' || token.value === '/' || token.value === '%')
      ) {
        consume();
        const right = parsePower();
        if (token.value === '*') {
          left *= right;
        } else if (token.value === '/') {
          if (right === 0) {
            throw new Error('Division by zero');
          }
          left /= right;
        } else {
          if (right === 0) {
            throw new Error('Division by zero');
          }
          left %= right;
        }
      } else {
        break;
      }
    }
    return left;
  }

  function parseAdditive(): number {
    let left = parseTerm();
    for (;;) {
      const token = peek();
      if (token?.kind === 'op' && (token.value === '+' || token.value === '-')) {
        consume();
        const right = parseTerm();
        left = token.value === '+' ? left + right : left - right;
      } else {
        break;
      }
    }
    return left;
  }

  const result = parseAdditive();
  if (position !== tokens.length) {
    throw new Error('Unexpected trailing characters');
  }
  return result;
}

export const calculateTool: Tool = {
  name: 'calculate',
  description:
    'Evaluate a mathematical expression and return the numeric result. Supports +, -, *, /, % (modulo), ^ (power), parentheses, constants pi and e, and functions such as sqrt, abs, round, floor, ceil, sin, cos, tan, asin, acos, atan, sinh, cosh, tanh, exp, ln, log, log2, pow, min and max. Example: "sqrt(pi * 9) + max(2, 5, 8)".',
  parameters: {
    type: 'object',
    properties: {
      expression: {
        type: 'string',
        description: 'The mathematical expression to evaluate, e.g. "sqrt(2) * 3".',
      },
    },
    required: ['expression'],
  },
  execute(args) {
    const expression = typeof args.expression === 'string' ? args.expression : '';
    if (!expression) {
      throw new Error('Missing "expression" argument');
    }
    return String(evaluateExpression(expression));
  },
};

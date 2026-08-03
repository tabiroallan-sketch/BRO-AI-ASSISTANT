import type { Tool } from './types.js';

type Token =
  | { kind: 'number'; value: string }
  | { kind: 'op'; value: string }
  | { kind: 'lparen' }
  | { kind: 'rparen' };

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

  function parsePrimary(): number {
    const token = consume();
    if (!token) {
      throw new Error('Unexpected end of expression');
    }
    if (token.kind === 'number') {
      return Number(token.value);
    }
    if (token.kind === 'op' && (token.value === '-' || token.value === '+')) {
      const operand = parsePrimary();
      return token.value === '-' ? -operand : operand;
    }
    if (token.kind === 'lparen') {
      const value = parseAdditive();
      const closing = consume();
      if (!closing || closing.kind !== 'rparen') {
        throw new Error('Unbalanced parentheses');
      }
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
    'Evaluate a simple arithmetic expression and return the numeric result. Supports +, -, *, /, % (modulo), ^ (power) and parentheses.',
  parameters: {
    type: 'object',
    properties: {
      expression: {
        type: 'string',
        description: 'The arithmetic expression to evaluate, e.g. "(2 + 3) * 4".',
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

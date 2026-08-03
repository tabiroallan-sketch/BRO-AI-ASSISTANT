import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { calculateTool, evaluateExpression } from '../src/tools/calculate.js';
import { clipboardTool } from '../src/tools/clipboard.js';
import { currentTimeTool } from '../src/tools/current-time.js';
import { filesystemTool } from '../src/tools/filesystem.js';
import { pdfReaderTool } from '../src/tools/pdf-reader.js';
import { weatherTool } from '../src/tools/weather.js';
import { webSearchTool } from '../src/tools/web-search.js';
import type { ToolContext } from '../src/tools/types.js';

const context: ToolContext = { userId: 'test-user' };

describe('calculate (extended)', () => {
  it('supports sqrt, abs, round, floor, ceil', () => {
    expect(evaluateExpression('sqrt(16)')).toBe(4);
    expect(evaluateExpression('abs(-5)')).toBe(5);
    expect(evaluateExpression('round(2.5)')).toBe(3);
    expect(evaluateExpression('floor(2.9)')).toBe(2);
    expect(evaluateExpression('ceil(2.1)')).toBe(3);
  });

  it('supports trig functions and logarithms', () => {
    expect(evaluateExpression('sin(0)')).toBe(0);
    expect(evaluateExpression('cos(0)')).toBe(1);
    expect(evaluateExpression('ln(e)')).toBeCloseTo(1);
    expect(evaluateExpression('log(100)')).toBeCloseTo(2);
    expect(evaluateExpression('exp(0)')).toBe(1);
    expect(evaluateExpression('pow(2, 10)')).toBe(1024);
  });

  it('supports constants pi and e', () => {
    expect(evaluateExpression('pi')).toBeCloseTo(Math.PI);
    expect(evaluateExpression('e')).toBeCloseTo(Math.E);
    expect(evaluateExpression('2 * pi')).toBeCloseTo(2 * Math.PI);
  });

  it('supports min and max with multiple arguments', () => {
    expect(evaluateExpression('max(1, 5, 3)')).toBe(5);
    expect(evaluateExpression('min(4, 2, 9)')).toBe(2);
  });

  it('rejects unknown functions, constants and bad arity', () => {
    expect(() => evaluateExpression('sqrt(1, 2)')).toThrow();
    expect(() => evaluateExpression('max()')).toThrow();
    expect(() => evaluateExpression('bogus(1)')).toThrow();
    expect(() => evaluateExpression('unknown_const')).toThrow();
  });

  it('exposes the calculate tool', async () => {
    const output = await calculateTool.execute({ expression: 'sqrt(16) + max(1,2,3)' }, context);
    expect(output).toBe('7');
  });
});

describe('current-time (timezone aware)', () => {
  it('returns ISO plus local time for a valid timezone', async () => {
    const output = await currentTimeTool.execute({ timezone: 'America/New_York' }, context);
    expect(String(output)).toContain('ISO 8601 (UTC):');
    expect(String(output)).toContain('America/New_York');
  });

  it('falls back gracefully for an invalid timezone', async () => {
    const output = await currentTimeTool.execute({ timezone: 'Not/AZone' }, context);
    expect(String(output)).toContain('Invalid timezone');
  });

  it('defaults to the server timezone when none given', async () => {
    const output = await currentTimeTool.execute({}, context);
    expect(String(output)).toContain('ISO 8601 (UTC):');
  });
});

describe('clipboard', () => {
  it('round-trips copy and paste per user', async () => {
    await clipboardTool.execute({ operation: 'copy', text: 'hello world' }, context);
    expect(await clipboardTool.execute({ operation: 'paste' }, context)).toBe('hello world');
    await clipboardTool.execute({ operation: 'clear' }, context);
    expect(await clipboardTool.execute({ operation: 'paste' }, context)).toBe(
      'Clipboard is empty.',
    );
  });

  it('isolates content between users', async () => {
    await clipboardTool.execute({ operation: 'copy', text: 'mine' }, context);
    expect(await clipboardTool.execute({ operation: 'paste' }, { userId: 'other-user' })).toBe(
      'Clipboard is empty.',
    );
  });

  it('rejects unknown operations', () => {
    expect(() => clipboardTool.execute({ operation: 'nope' }, context)).toThrow(
      /Unknown clipboard operation/,
    );
  });
});

describe('filesystem (sandboxed)', () => {
  let sandboxRoot: string;

  beforeAll(async () => {
    sandboxRoot = await mkdtemp(join(tmpdir(), 'bro-sandbox-'));
    process.env.TOOL_FS_ROOT = sandboxRoot;
  });

  afterAll(async () => {
    delete process.env.TOOL_FS_ROOT;
    await rm(sandboxRoot, { recursive: true, force: true });
  });

  it('writes, lists, reads and deletes files', async () => {
    const write = await filesystemTool.execute(
      { operation: 'write', path: 'notes.txt', content: 'first line' },
      context,
    );
    expect(write).toContain('Wrote');

    const list = await filesystemTool.execute({ operation: 'list', path: '' }, context);
    expect(list).toContain('notes.txt');

    const read = await filesystemTool.execute({ operation: 'read', path: 'notes.txt' }, context);
    expect(read).toBe('first line');

    const del = await filesystemTool.execute({ operation: 'delete', path: 'notes.txt' }, context);
    expect(del).toContain('Deleted');

    const readAgain = await filesystemTool.execute(
      { operation: 'read', path: 'notes.txt' },
      context,
    );
    expect(readAgain).toContain('File not found');
  });

  it('supports nested paths', async () => {
    await filesystemTool.execute(
      { operation: 'write', path: 'reports/jan/report.txt', content: 'data' },
      context,
    );
    const list = await filesystemTool.execute({ operation: 'list', path: 'reports/jan' }, context);
    expect(list).toContain('report.txt');
  });

  it('rejects paths that escape the sandbox', async () => {
    await expect(
      filesystemTool.execute({ operation: 'read', path: '../secret.txt' }, context),
    ).rejects.toThrow(/escapes the sandbox/);
    await expect(
      filesystemTool.execute(
        { operation: 'write', path: '../../etc/evil.txt', content: 'x' },
        context,
      ),
    ).rejects.toThrow(/escapes the sandbox/);
  });
});

function buildPdf(text: string): Buffer {
  const escaped = text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const stream = `BT /F1 24 Tf 72 720 Td (${escaped}) Tj ET`;
  const bodies = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  const chunks: string[] = ['%PDF-1.4\n'];
  const offsets: number[] = [0];
  for (let i = 0; i < bodies.length; i += 1) {
    offsets.push(Buffer.byteLength(chunks.join(''), 'latin1'));
    chunks.push(`${i + 1} 0 obj\n${bodies[i]}\nendobj\n`);
  }
  const xrefOffset = Buffer.byteLength(chunks.join(''), 'latin1');
  let xref = `xref\n0 ${bodies.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) {
    xref += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  const trailer = `trailer\n<< /Size ${bodies.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(chunks.join('') + xref + trailer, 'latin1');
}

describe('pdf-reader', () => {
  let sandboxRoot: string;

  beforeAll(async () => {
    sandboxRoot = await mkdtemp(join(tmpdir(), 'bro-sandbox-'));
    process.env.TOOL_FS_ROOT = sandboxRoot;
    const file = join(sandboxRoot, 'test-user');
    await mkdir(file, { recursive: true });
    await writeFile(join(file, 'hello.pdf'), buildPdf('Hello PDF world'));
    await writeFile(join(file, 'broken.pdf'), 'this is not a pdf');
  });

  afterAll(async () => {
    delete process.env.TOOL_FS_ROOT;
    await rm(sandboxRoot, { recursive: true, force: true });
  });

  it('extracts text from a valid PDF', async () => {
    const output = await pdfReaderTool.execute({ path: 'hello.pdf' }, context);
    expect(String(output)).toContain('Hello PDF world');
  });

  it('reports missing files', async () => {
    const output = await pdfReaderTool.execute({ path: 'nope.pdf' }, context);
    expect(String(output)).toContain('File not found');
  });

  it('reports parse failures for non-PDF files', async () => {
    const output = await pdfReaderTool.execute({ path: 'broken.pdf' }, context);
    expect(String(output)).toContain('Failed to parse PDF');
  });
});

describe('web tools (graceful failures only)', () => {
  it('rejects missing required arguments', async () => {
    await expect(webSearchTool.execute({}, context)).rejects.toThrow(/Missing/);
    await expect(weatherTool.execute({}, context)).rejects.toThrow(/Missing/);
  });

  it('weather reports an unknown location gracefully', async () => {
    const fetchMock = vi.fn(async (): Promise<Response> => {
      return {
        ok: true,
        status: 200,
        json: async () => ({ results: [] }),
      } as unknown as Response;
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const output = await weatherTool.execute({ location: 'zzz-no-such-place-12345' }, context);
      expect(String(output)).toContain('Could not find any location');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

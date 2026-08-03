import { readFile, stat } from 'node:fs/promises';
import { PDFParse } from 'pdf-parse';
import type { Tool } from './types.js';
import { resolveSandboxPath } from './sandbox.js';

const MAX_PDF_SIZE_BYTES = 20_000_000;
const MAX_TEXT_LENGTH = 50_000;

export const pdfReaderTool: Tool = {
  name: 'read_pdf',
  description:
    'Extract and return the text content of a PDF file stored in the user\'s sandbox. Provide the path relative to the sandbox root, e.g. "reports/annual.pdf". Use this when the user asks about the contents of a PDF document.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path to the PDF file relative to the user sandbox, e.g. "docs/manual.pdf".',
      },
    },
    required: ['path'],
  },
  async execute(args, context) {
    const rawPath = typeof args.path === 'string' ? args.path : '';
    if (!rawPath) {
      throw new Error('Missing "path" argument');
    }
    const target = resolveSandboxPath(context.userId, rawPath);
    const info = await stat(target).catch(() => null);
    if (!info || !info.isFile()) {
      return `File not found: ${rawPath}`;
    }
    if (info.size > MAX_PDF_SIZE_BYTES) {
      return `File "${rawPath}" is too large to parse (${info.size} bytes, max ${MAX_PDF_SIZE_BYTES}).`;
    }
    const buffer = await readFile(target);
    const pdf = new PDFParse({ data: buffer });
    try {
      const result = await pdf.getText();
      const text = result.text.trim();
      if (!text) {
        return `Extracted no text from ${rawPath} (${result.total} page(s)). It may be a scanned/image PDF.`;
      }
      const pagesNote = `${result.total} page(s), ${buffer.length} bytes`;
      const truncated = text.length > MAX_TEXT_LENGTH ? '\n\n[text truncated]' : '';
      return `Text extracted from ${rawPath} (${pagesNote}):\n\n${text.slice(0, MAX_TEXT_LENGTH)}${truncated}`;
    } catch (error) {
      return `Failed to parse PDF "${rawPath}": ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      await pdf.destroy();
    }
  },
};

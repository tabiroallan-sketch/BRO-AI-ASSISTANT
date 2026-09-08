import { describe, expect, it } from 'vitest';
import { inflateSync } from 'node:zlib';
import { buildXlsx } from '../../src/lead-finder/xlsx.js';

/**
 * Extracts and inflates a named entry from the produced OOXML ZIP package.
 */
function extractEntry(buffer: Buffer, name: string): Buffer | null {
  let offset = 0;
  while (offset < buffer.length - 30) {
    if (buffer.readUInt32LE(offset) !== 0x04034b50) {
      offset += 1;
      continue;
    }
    const method = buffer.readUInt16LE(offset + 8);
    const compSize = buffer.readUInt32LE(offset + 18);
    const nameLen = buffer.readUInt16LE(offset + 26);
    const extraLen = buffer.readUInt16LE(offset + 28);
    const entryName = buffer.toString('utf8', offset + 30, offset + 30 + nameLen);
    const dataStart = offset + 30 + nameLen + extraLen;

    if (entryName === name) {
      const data = buffer.subarray(dataStart, dataStart + compSize);
      return method === 0 ? Buffer.from(data) : inflateSync(data);
    }
    offset = dataStart + compSize;
  }
  return null;
}

describe('lead finder xlsx export', () => {
  it('produces a valid ZIP-style xlsx package', () => {
    const buffer = buildXlsx([
      ['Company', 'Score'],
      ['Acme Dental', 95],
      ['Beta & Co', 40],
    ]);

    expect(buffer.subarray(0, 2).toString()).toBe('PK');
    expect(buffer.readUInt32LE(buffer.length - 22)).toBe(0x06054b50);

    const sheet = extractEntry(buffer, 'xl/worksheets/sheet1.xml');
    const strings = extractEntry(buffer, 'xl/sharedStrings.xml');
    expect(sheet).not.toBeNull();
    expect(strings).not.toBeNull();
    expect(sheet!.toString()).toContain('<sheetData>');
    expect(sheet!.toString()).toContain('<row>');
    expect(strings!.toString()).toContain('Acme Dental');
    expect(strings!.toString()).toContain('Beta');
  });

  it('escapes XML special characters in shared strings', () => {
    const buffer = buildXlsx([['Name'], ['A <B> & "C"']]);
    const strings = extractEntry(buffer, 'xl/sharedStrings.xml');
    expect(strings!.toString()).toContain('A &lt;B&gt; &amp; &quot;C&quot;');
  });

  it('strips control characters invalid in XML 1.0', () => {
    const buffer = buildXlsx([['Name'], ['Bad \u0001\u0002Chars']]);
    const strings = extractEntry(buffer, 'xl/sharedStrings.xml');
    expect(strings!.toString()).toContain('Bad Chars');
    expect(strings!.toString()).not.toContain('\u0001');
  });

  it('emits numeric and boolean cell types', () => {
    const buffer = buildXlsx([
      ['Name', 'Count', 'Active'],
      ['Acme', 7, true],
    ]);
    const sheet = extractEntry(buffer, 'xl/worksheets/sheet1.xml');
    expect(sheet!.toString()).toContain('<c t="n"><v>7</v></c>');
    expect(sheet!.toString()).toContain('<c t="b"><v>1</v></c>');
  });

  it('handles an empty row set without crashing', () => {
    const buffer = buildXlsx([['Header']]);
    const sheet = extractEntry(buffer, 'xl/worksheets/sheet1.xml');
    expect(sheet!.toString()).toContain('<sheetData>');
  });
});

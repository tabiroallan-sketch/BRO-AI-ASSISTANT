import { deflateSync } from 'node:zlib';

type RowValue = string | number | boolean | null | undefined;

/**
 * Minimal dependency-free OOXML (.xlsx) writer. Produces a valid package with a
 * single worksheet, shared strings, and inline styles-free cells. Uses Node's
 * built-in `zlib` for DEFLATE compression (per the ZIP spec, data entries in an
 * .xlsx use the "deflate" method).
 */

const CRC_TABLE: Uint32Array = ((): Uint32Array => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) {
    const byte = buffer[i]!;
    crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function xmlEscape(value: string): string {
  // Escape XML 1.0 specials and strip control characters invalid in XML 1.0
  // (0x00-0x08, 0x0B, 0x0C, 0x0E-0x1F). Tab/LF/CR are allowed.
  let stripped = '';
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) {
      continue;
    }
    stripped += value[i];
  }
  return stripped
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function makeZipEntry(fileName: string, content: string): Buffer {
  const localHeaderName = Buffer.from(fileName, 'utf8');
  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(0x04034b50, 0); // local file header signature
  localHeader.writeUInt16LE(20, 4); // version needed
  localHeader.writeUInt16LE(0x0800, 6); // flags: UTF-8
  localHeader.writeUInt16LE(8, 8); // method: deflate
  localHeader.writeUInt32LE(0, 10); // mod time/date
  localHeader.writeUInt16LE(0x21, 10); // mod date
  localHeader.writeUInt32LE(crc32(Buffer.from(content, 'utf8')), 14); // crc-32
  const deflated = deflateSync(Buffer.from(content, 'utf8'));
  localHeader.writeUInt32LE(deflated.length, 18); // compressed size
  localHeader.writeUInt32LE(Buffer.byteLength(content, 'utf8'), 22); // uncompressed size
  localHeader.writeUInt16LE(localHeaderName.length, 26); // name length
  localHeader.writeUInt16LE(0, 28); // extra field length

  return Buffer.concat([localHeader, localHeaderName, deflated]);
}

/**
 * Serializes tabular data (first row = headers) into a valid .xlsx Buffer.
 */
export function buildXlsx(rows: RowValue[][]): Buffer {
  const sharedStrings: string[] = [];
  const sharedIndex = new Map<string, number>();
  const sheetRows: RowValue[][] = rows;

  // Collect shared strings and build the sheet XML.
  const sheetCells: string[] = [];
  for (const row of sheetRows) {
    const cells: string[] = [];
    for (const value of row) {
      if (typeof value === 'number') {
        cells.push(`<c t="n"><v>${Number.isFinite(value) ? String(value) : ''}</v></c>`);
      } else if (typeof value === 'boolean') {
        cells.push(`<c t="b"><v>${value ? '1' : '0'}</v></c>`);
      } else if (value === null || value === undefined || value === '') {
        cells.push(`<c/>`);
      } else {
        const text = xmlEscape(String(value));
        let index = sharedIndex.get(text);
        if (index === undefined) {
          index = sharedStrings.length;
          sharedIndex.set(text, index);
          sharedStrings.push(text);
        }
        cells.push(`<c t="s"><v>${index}</v></c>`);
      }
    }
    sheetCells.push(`<row>${cells.join('')}</row>`);
  }

  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetData>${sheetCells.join('')}</sheetData>
</worksheet>`;

  const sharedStringsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${colsCount(
    rows,
  )}" uniqueCount="${sharedStrings.length}">${sharedStrings
    .map((s) => `<si><t>${s}</t></si>`)
    .join('')}</sst>`;

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Leads" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;

  const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  const workbookRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="1"><fill><patternFill patternType="none"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>
</styleSheet>`;

  const rootXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
<TotalTime>0</TotalTime></Properties>`;

  const parts: Array<[string, string]> = [
    ['[Content_Types].xml', contentTypesXml],
    ['_rels/.rels', workbookRelsXml],
    ['docProps/app.xml', rootXml],
    ['xl/workbook.xml', workbookXml],
    ['xl/_rels/workbook.xml.rels', relsXml],
    ['xl/worksheets/sheet1.xml', sheetXml],
    ['xl/sharedStrings.xml', sharedStringsXml],
    ['xl/styles.xml', stylesXml],
  ];

  const entries: Buffer[] = [];
  const centralDirectory: Buffer[] = [];
  let offset = 0;

  for (const [fileName, content] of parts) {
    const entry = makeZipEntry(fileName, content);
    entries.push(entry);

    const nameBuffer = Buffer.from(fileName, 'utf8');
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // central directory header
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0x0800, 8); // flags
    central.writeUInt16LE(8, 10); // method
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc32(Buffer.from(content, 'utf8')), 16);
    central.writeUInt32LE(deflateSync(Buffer.from(content, 'utf8')).length, 20);
    central.writeUInt32LE(Buffer.byteLength(content, 'utf8'), 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt32LE(offset, 42);
    centralDirectory.push(Buffer.concat([central, nameBuffer]));
    offset += entry.length;
  }

  const entriesConcat = Buffer.concat(entries);
  const centralConcat = Buffer.concat(centralDirectory);
  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0); // end of central directory
  endRecord.writeUInt16LE(centralDirectory.length, 8);
  endRecord.writeUInt16LE(centralDirectory.length, 10);
  endRecord.writeUInt32LE(centralConcat.length, 12);
  endRecord.writeUInt32LE(entriesConcat.length, 16);

  return Buffer.concat([entriesConcat, centralConcat, endRecord]);
}

function colsCount(rows: RowValue[][]): number {
  let max = 0;
  for (const row of rows) max = Math.max(max, row.length);
  return max;
}

export { xmlEscape };

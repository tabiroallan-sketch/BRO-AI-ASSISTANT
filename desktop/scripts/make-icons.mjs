import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Generates the desktop icons (icon.png, tray.png, trayTemplate.png) as
 * deterministic PNGs with no image dependencies. The icon is a rounded dark
 * square with a gradient and a simple "B" glyph.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'resources');

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, 'ascii');
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crcBuffer]);
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // color type RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function lerp(a, b, t) {
  return Math.round(a + (b - a) * t);
}

function buildIcon(size) {
  const radius = size * 0.22;
  const pixels = Buffer.alloc(size * size * 4);
  const centre = size / 2;
  const inner = size * 0.5;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      // Rounded-square mask.
      const dx = Math.max(radius - x, 0, x - (size - radius));
      const dy = Math.max(radius - y, 0, y - (size - radius));
      const inside = dx * dx + dy * dy <= radius * radius || (dx === 0 && dy === 0);
      if (!inside) {
        pixels[i + 3] = 0;
        continue;
      }
      // Diagonal gradient (indigo -> violet).
      const t = (x + y) / (size * 2);
      pixels[i] = lerp(31, 109, t);
      pixels[i + 1] = lerp(41, 70, t);
      pixels[i + 2] = lerp(65, 208, t);
      pixels[i + 3] = 255;
      // Simple "B" glyph drawn with filled pixels.
      const glyph = drawB(x, y, size, centre, inner, size * 0.28, size * 0.13);
      if (glyph) {
        pixels[i] = 237;
        pixels[i + 1] = 243;
        pixels[i + 2] = 255;
      }
    }
  }
  return encodePng(size, size, pixels);
}

function drawB(x, y, size, centre, inner, strokeWidth, bar) {
  const left = centre - inner / 2 + bar;
  const right = centre + inner / 2 - bar;
  const top = centre - inner / 2 + bar;
  const bottom = centre + inner / 2 - bar;
  const mid = centre;
  const inStem = x >= left - strokeWidth && x <= left + strokeWidth && y >= top && y <= bottom;
  if (inStem) {
    return true;
  }
  const inTopLoop = x >= left - strokeWidth && x <= right && y >= mid - strokeWidth && y <= mid + strokeWidth;
  const inBottomLoop = x >= left - strokeWidth && x <= right && y >= mid + bar - strokeWidth && y <= mid + bar + strokeWidth;
  if (inTopLoop || inBottomLoop) {
    return true;
  }
  const inTopRight = x >= right - strokeWidth && x <= right + strokeWidth && y >= top && y <= mid;
  const inBottomRight = x >= right - strokeWidth && x <= right + strokeWidth && y >= mid + bar && y <= bottom;
  if (inTopRight || inBottomRight) {
    return true;
  }
  const inTopCap = x >= left - strokeWidth && x <= right && y >= top - strokeWidth && y <= top + strokeWidth;
  const inMidCap = x >= left - strokeWidth && x <= right && y >= mid - strokeWidth && y <= mid + strokeWidth;
  const inBottomCap = x >= left - strokeWidth && x <= right && y >= bottom - strokeWidth && y <= bottom + strokeWidth;
  return inTopCap || inMidCap || inBottomCap;
}

function buildTray(size) {
  // Monochrome glyph on transparent background (template-friendly white).
  const pixels = Buffer.alloc(size * size * 4);
  const centre = size / 2;
  const inner = size * 0.6;
  const strokeWidth = Math.max(1, size * 0.09);
  const bar = size * 0.12;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      if (drawB(x, y, size, centre, inner, strokeWidth, bar)) {
        pixels[i] = 255;
        pixels[i + 1] = 255;
        pixels[i + 2] = 255;
        pixels[i + 3] = 255;
      }
    }
  }
  return encodePng(size, size, pixels);
}

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, 'icon.png'), buildIcon(512));
writeFileSync(join(OUT_DIR, 'icon-256.png'), buildIcon(256));
writeFileSync(join(OUT_DIR, 'tray.png'), buildTray(32));
writeFileSync(join(OUT_DIR, 'trayTemplate.png'), buildTray(32));
console.log(`Wrote icons to ${OUT_DIR}`);

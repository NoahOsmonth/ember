'use strict';

/**
 * Generate the committed build icons.
 *
 * The assets are checked in, but this script keeps them reproducible: it draws
 * the ember glyph into an RGBA buffer, writes a PNG, and wraps PNG frames into
 * an ICO container. Run `npm run icons` after changing the drawing.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const BUILD = path.join(ROOT, 'build');
const OUTER = [255, 106, 61];
const INNER = [255, 209, 102];
const SAMPLES = 4;

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let index = 0; index < buffer.length; index += 1) {
    crc ^= buffer[index];
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/**
 * @param {number} width
 * @param {number} height
 * @param {Buffer} pixels RGBA, row-major
 * @returns {Buffer}
 */
function png(width, height, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * stride] = 0; // filter: none
    pixels.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** The flame silhouette: pointed top, round bottom. */
function inside(x, y) {
  const t = (y + 1) / 2;
  if (t < 0 || t > 1) return false;
  const half = 0.86 * Math.pow(t, 0.55) * Math.pow(1 - t, 0.22);
  const centre = 0.06 * Math.sin(t * 2.2);
  return Math.abs(x - centre) <= half;
}

function inner(x, y) {
  const t = (y + 1) / 2;
  const half = 0.86 * Math.pow(t, 0.55) * Math.pow(1 - t, 0.22);
  const centre = 0.06 * Math.sin(t * 2.2);
  return t > 0.3 && Math.abs(x - centre) <= half * 0.45;
}

/**
 * @param {number} size
 * @returns {Buffer} RGBA pixels
 */
function draw(size) {
  const pixels = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let covered = 0;
      let red = 0;
      let green = 0;
      let blue = 0;
      for (let sy = 0; sy < SAMPLES; sy += 1) {
        for (let sx = 0; sx < SAMPLES; sx += 1) {
          const x = ((px + (sx + 0.5) / SAMPLES) / size) * 2 - 1;
          const y = ((py + (sy + 0.5) / SAMPLES) / size) * 2 - 1;
          if (!inside(x, y)) continue;
          covered += 1;
          const colour = inner(x, y) ? INNER : OUTER;
          red += colour[0];
          green += colour[1];
          blue += colour[2];
        }
      }
      const offset = (py * size + px) * 4;
      if (covered === 0) continue;
      pixels[offset] = Math.round(red / covered);
      pixels[offset + 1] = Math.round(green / covered);
      pixels[offset + 2] = Math.round(blue / covered);
      pixels[offset + 3] = Math.round((covered / (SAMPLES * SAMPLES)) * 255);
    }
  }
  return pixels;
}

/**
 * @param {Array<{ size: number, png: Buffer }>} frames
 * @returns {Buffer}
 */
function ico(frames) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(frames.length, 4);
  const entries = [];
  let offset = 6 + frames.length * 16;
  for (const frame of frames) {
    const entry = Buffer.alloc(16);
    entry[0] = frame.size >= 256 ? 0 : frame.size;
    entry[1] = frame.size >= 256 ? 0 : frame.size;
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(frame.png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += frame.png.length;
    entries.push(entry);
  }
  return Buffer.concat([header, ...entries, ...frames.map((frame) => frame.png)]);
}

fs.mkdirSync(BUILD, { recursive: true });
const sizes = [16, 32, 48, 256];
const frames = sizes.map((size) => ({ size, png: png(size, size, draw(size)) }));
fs.writeFileSync(path.join(BUILD, 'icon.ico'), ico(frames));
fs.writeFileSync(path.join(BUILD, 'trayTemplate.png'), frames[1].png);
process.stdout.write(`wrote ${sizes.join('/')} ICO and a 32 px tray PNG\n`);

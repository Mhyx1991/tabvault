// Generates TabVault icons: a blue rounded square with a white vault dial.
// Zero dependencies — hand-rolled PNG encoder (RGBA, zlib via node:zlib).

import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'src', 'assets', 'icons');
fs.mkdirSync(outDir, { recursive: true });

/* ------------------------------ PNG encoder ------------------------------ */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

/* -------------------------------- drawing -------------------------------- */

const clamp01 = (x) => Math.min(1, Math.max(0, x));

/** Signed distance to a rounded rectangle centered at origin. */
function sdRoundBox(x, y, halfW, halfH, r) {
  const qx = Math.abs(x) - (halfW - r);
  const qy = Math.abs(y) - (halfH - r);
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r;
}

function mix(a, b, t) {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t
  ];
}

function drawIcon(size) {
  const px = Buffer.alloc(size * size * 4);
  const bg = [37, 99, 235];     // #2563EB
  const fg = [255, 255, 255];
  const half = size / 2;
  const boxHalf = half - size * 0.015;
  const cornerR = size * 0.225;

  const ringR = size * 0.30;
  const ringW = Math.max(1.2, size * 0.088);
  const slotHalfW = size * 0.042;
  const slotHalfH = size * 0.155;
  const slotR = Math.min(slotHalfW, slotHalfH) * 0.9;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - half;
      const dy = y + 0.5 - half;

      const boxD = sdRoundBox(dx, dy, boxHalf, boxHalf, cornerR);
      const boxCov = clamp01(0.5 - boxD);
      if (boxCov <= 0) continue; // transparent corner

      const ringD = Math.abs(Math.hypot(dx, dy) - ringR);
      const ringCov = clamp01(0.5 - (ringD - ringW / 2));
      const slotD = sdRoundBox(dx, dy, slotHalfW, slotHalfH, slotR);
      const slotCov = clamp01(0.5 - slotD);
      const glyph = Math.min(1, Math.max(ringCov, slotCov));

      const [r, g, b] = mix(bg, fg, glyph);
      const i = (y * size + x) * 4;
      px[i] = Math.round(r);
      px[i + 1] = Math.round(g);
      px[i + 2] = Math.round(b);
      px[i + 3] = Math.round(boxCov * 255);
    }
  }
  return encodePNG(size, size, px);
}

for (const size of [16, 32, 48, 128]) {
  const png = drawIcon(size);
  const file = path.join(outDir, `icon${size}.png`);
  fs.writeFileSync(file, png);
  console.log(`wrote ${file} (${png.length} bytes)`);
}
console.log('icons done');

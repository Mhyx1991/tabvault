// Packages TabVault for the Chrome Web Store: validates the manifest,
// verifies referenced files exist, then writes dist/tabvault-v<version>.zip
// with manifest.json at the zip root. Zero dependencies (STORE-method zip).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const INCLUDE = ['manifest.json', 'README.md', 'PRIVACY.md', 'LICENSE'];
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.freebuff', 'docs', 'scripts', 'tests', 'store-assets']);

/* ------------------------------ pre-flight ------------------------------ */

const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

const referenced = [
  ...Object.values(manifest.icons || {}),
  ...Object.values(manifest.action?.default_icon || {}),
  manifest.background?.service_worker,
  manifest.action?.default_popup,
  manifest.options_ui?.page
].filter(Boolean);

const missing = referenced.filter((f) => !fs.existsSync(path.join(root, f)));
if (missing.length) {
  console.error('Packaging aborted — missing files referenced by manifest.json:');
  for (const f of missing) console.error('  ' + f);
  process.exit(1);
}
console.log(`manifest ok — v${manifest.version}, ${referenced.length} referenced files present`);

/* --------------------------------- gather -------------------------------- */

const files = [...INCLUDE];
(function walk(dir, base = '') {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const rel = base ? `${base}/${entry.name}` : entry.name;
    const full = path.join(root, rel);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) && base === '') continue;
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(full, rel);
    } else {
      files.push(rel);
    }
  }
})(root, '');
// Deduplicate + keep deterministic order.
const unique = [...new Set(files)].sort();

/* ------------------------------- zip writer ------------------------------ */

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
function dosDateTime(d) {
  const time = ((d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1)) & 0xffff;
  const date = (((d.getUTCFullYear() - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate()) & 0xffff;
  return { time, date };
}

function zipStore(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;
  const { time, date } = dosDateTime(new Date());

  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);        // version needed
    local.writeUInt16LE(0x0800, 6);    // UTF-8 flag
    local.writeUInt16LE(0, 8);         // method: store
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuf, data);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(0, 10);
    cd.writeUInt16LE(time, 12);
    cd.writeUInt16LE(date, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(0, 38);           // external attrs
    cd.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([cd, nameBuf]));

    offset += local.length + nameBuf.length + data.length;
  }

  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, centralBuf, eocd]);
}

/* --------------------------------- write --------------------------------- */

const entries = unique.map((rel) => ({
  name: rel,
  data: fs.readFileSync(path.join(root, rel))
}));

fs.mkdirSync(dist, { recursive: true });
const outName = `tabvault-v${manifest.version}.zip`;
const outPath = path.join(dist, outName);
fs.writeFileSync(outPath, zipStore(entries));

const total = entries.reduce((n, e) => n + e.data.length, 0);
console.log(`\npacked ${entries.length} files (${(total / 1024).toFixed(0)} KB raw) → dist/${outName} (${(fs.statSync(outPath).size / 1024).toFixed(0)} KB)`);
console.log('Ready to upload to the Chrome Web Store.');

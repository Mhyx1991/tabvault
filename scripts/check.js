// Syntax-check every .js file in the project (ESM, per package.json "type").
// Exit code 1 if any file fails to parse.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git' || entry.name === '.freebuff') continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (entry.name.endsWith('.js') || entry.name.endsWith('.mjs')) out.push(p);
  }
  return out;
}

const files = walk(root);
let failed = 0;
for (const f of files) {
  try {
    execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
    console.log(`ok   ${path.relative(root, f)}`);
  } catch (e) {
    failed++;
    console.error(`FAIL ${path.relative(root, f)}\n${e.stderr?.toString() || e.message}`);
  }
}
if (failed) {
  console.error(`\n${failed} file(s) failed syntax check`);
  process.exit(1);
}
console.log(`\nall ${files.length} files parsed cleanly`);

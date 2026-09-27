// Regression: a single broken ESM named-import silently kills an entire UI
// page (no code runs, so NO button works) while unit tests of the core keep
// passing. This suite statically walks the whole import graph of every entry
// point and fails if any named import is missing from its target module —
// catching the exact bug class that shipped as "nothing happens when I click".
//
// Static by design: UI modules touch DOM/chrome at module scope, so they
// cannot be imported under plain Node. Parsing instead of executing also
// covers link errors that would only surface at runtime inside the browser.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/* ------------------------------ module graph ------------------------------ */

// Minimal ESM parser: import/export-from/static-import named + namespace +
// default. Handles single/double/backtick quotes, // and block comments,
// and multi-line clauses. Good enough to validate this repo's own style.
function parseSpecifiers(src) {
  // Strip comments (no regex literals containing // exist in import/export statements).
  const clean = src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const specs = [];
  const re = /\b(import|export)\b\s*([\s\S]*?)\s*from\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(clean)) !== null) {
    const clause = m[2].trim();
    const names = [];
    if (clause.startsWith('{')) {
      const inner = clause.slice(clause.indexOf('{') + 1, clause.lastIndexOf('}'));
      for (let part of inner.split(',')) {
        part = part.trim();
        if (!part) continue;
        // "X as Y" → imported name is X (the binding the module must provide)
        const imported = part.split(/\s+as\s+/)[0].trim();
        if (imported) names.push(imported);
      }
    }
    specs.push({ kind: m[1], source: m[3], names });
  }
  // Bare side-effect imports, `export { a, b };` and `export function/const/class/let/var`
  const re2 = /\bimport\s*['"]([^'"]+)['"]/g;
  while ((m = re2.exec(clean)) !== null) specs.push({ kind: 'import', source: m[1], names: [] });
  const re3 = /\bexport\s*\{([^}]*)\}/g;
  while ((m = re3.exec(clean)) !== null) {
    for (let part of m[1].split(',')) {
      part = part.trim();
      if (!part) continue;
      const local = part.split(/\s+as\s+/)[0].trim();
      if (local) specs.push({ kind: 'export-local', source: null, names: [local] });
    }
  }
  const re4 = /\bexport\s+(?:async\s+)?(function|class)\s*\*?\s*([A-Za-z_$][\w$]*)/g;
  while ((m = re4.exec(clean)) !== null) specs.push({ kind: 'export-local', source: null, names: [m[2]] });
  const re5 = /\bexport\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g;
  while ((m = re5.exec(clean)) !== null) specs.push({ kind: 'export-local', source: null, names: [m[1]] });
  return specs;
}

function parseImports(src) {
  return parseSpecifiers(src).filter((s) => s.kind === 'import' && s.source);
}

function resolveSource(fromFile, source) {
  if (!source.startsWith('.')) return null; // bare specifier — none in this repo
  const abs = resolve(dirname(fromFile), source);
  for (const candidate of [abs, abs + '.js', join(abs, 'index.js')]) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch { /* try next */ }
  }
  throw new Error(`Cannot resolve '${source}' from ${fromFile}`);
}

function collect(startFiles) {
  const exportsOf = new Map(); // file → Set of exported names
  const graph = new Map();     // file → [{file, names}]
  const queue = [...startFiles];
  const seen = new Set();
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const src = readFileSync(file, 'utf8');
    const specs = parseSpecifiers(src);
    graph.set(file, []);
    for (const s of specs) {
      if (s.kind === 'export-local') {
        if (!exportsOf.has(file)) exportsOf.set(file, new Set());
        exportsOf.get(file).add(s.names[0]);
      }
      if (!s.source) continue;
      const target = resolveSource(file, s.source);
      if (!target) continue; // bare specifier (none expected, but be safe)
      graph.get(file).push({ file: target, names: s.names });
      queue.push(target);
    }
    // re-export via `export { x } from './y.js'` — kind 'export', has source
    for (const edge of graph.get(file)) {
      // imports validated separately; export-from edges also count as exports
    }
  }
  return { exportsOf, graph };
}

/* --------------------------------- checks --------------------------------- */

function entryPoints() {
  const files = [];
  const html = ['src/ui/popup.html', 'src/ui/dashboard.html', 'src/ui/sidepanel.html'];
  for (const h of html) {
    const src = readFileSync(join(ROOT, h), 'utf8');
    const m = [...src.matchAll(/<script[^>]*type="module"[^>]*src="([^"]+)"/g)];
    for (const s of m) files.push(resolve(dirname(join(ROOT, h)), s[1]));
  }
  files.push(join(ROOT, 'src/background/service-worker.js'));
  return files;
}

test('every HTML entry point declares its module script with type="module"', () => {
  for (const h of ['src/ui/popup.html', 'src/ui/dashboard.html', 'src/ui/sidepanel.html']) {
    const src = readFileSync(join(ROOT, h), 'utf8');
    assert.match(src, /<script[^>]*type="module"/, `${h} must load its JS as a module (MV3 CSP)`);
  }
});

test('extension entry points exist on disk', () => {
  for (const f of entryPoints()) {
    assert.ok(existsSync(f), `entry point missing: ${f}`);
  }
});

test('every named import in the ENTIRE extension import graph resolves', () => {
  const starts = entryPoints();
  const { exportsOf, graph } = collect(starts);

  // Compute exported names per module, including `export { x } from './y.js'`
  // and `export { x }` (local re-export of an imported binding).
  for (const [file, edges] of graph) {
    const src = readFileSync(file, 'utf8');
    const specs = parseSpecifiers(src);
    if (!exportsOf.has(file)) exportsOf.set(file, new Set());
    const exp = exportsOf.get(file);
    for (const s of specs) {
      if (s.kind !== 'export' || !s.source) continue;
      const target = resolveSource(file, s.source);
      for (const n of s.names) exp.add(n);
      // validate through-edge too
      edges.push({ file: target, names: s.names });
    }
  }

  const errors = [];
  for (const [file, edges] of graph) {
    for (const edge of edges) {
      const targetExports = exportsOf.get(edge.file);
      if (!targetExports) continue; // target not visited yet (cycle); skip
      for (const name of edge.names) {
        if (!targetExports.has(name)) {
          const rel = (p) => p.replace(ROOT + '\\', '').replace(ROOT + '/', '');
          errors.push(`${rel(file)} imports { ${name} } from ${rel(edge.file)} — not exported there`);
        }
      }
    }
  }
  assert.deepEqual(errors, [], `Broken ESM links (these silently kill entire UI pages):\n${errors.join('\n')}`);
});

test('every relative import in the graph resolves to a real file', () => {
  const starts = entryPoints();
  collect(starts); // throws on unresolvable paths
  assert.ok(starts.length >= 4, `expected popup, dashboard, sidepanel and service worker entry points, got ${starts.length}`);
});

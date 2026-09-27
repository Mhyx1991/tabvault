// Fuzz + adversarial tests: the backup validator, snapshot restore, and
// storage layer must survive garbage without corrupting state or crashing.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeChrome, installFakeIndexedDB, resetIds } from './helpers/fake-env.js';
import { garbageInputs } from './helpers/url-cases.js';

beforeEach(() => {
  resetIds();
  installFakeIndexedDB();
  installFakeChrome();
});

test('validator fuzz: 500 adversarial inputs never crash and never return ok: true with errors', async () => {
  const { validateBackup } = await import('../src/core/backup.js');
  const inputs = garbageInputs(500, 1234);

  let rejected = 0;
  for (const input of inputs) {
    let result;
    try {
      result = validateBackup(input);
    } catch (e) {
      assert.fail(`validator threw on input: ${JSON.stringify(input).slice(0, 120)} — ${e.message}`);
    }
    assert.equal(typeof result.ok, 'boolean');
    assert.ok(Array.isArray(result.errors));
    if (result.ok) {
      assert.equal(result.errors.length, 0);
      assert.ok(result.data, 'ok result must carry normalized data');
      // Normalized data must be structurally safe.
      for (const ws of result.data.workspaces) {
        assert.equal(typeof ws.id, 'string');
        assert.equal(typeof ws.name, 'string');
        assert.ok(Array.isArray(ws.tabs));
      }
    } else {
      rejected++;
      assert.equal(result.data, null, 'rejected input must not carry data');
    }
  }
  assert.ok(rejected > 200, `expected most garbage to be rejected, rejected ${rejected}/500`);
});

test('prototype pollution via __proto__ keys is neutralized', async () => {
  const { validateBackup } = await import('../src/core/backup.js');
  const evil = JSON.parse('{"format":"tabvault-backup","version":1,"settings":{"__proto__":{"polluted":true},"theme":"dark"}}');
  const v = validateBackup(evil);
  assert.equal(({}).polluted, undefined, 'Object prototype must stay clean');
  if (v.ok) assert.equal(v.data.settings.polluted, undefined);
  assert.equal(({}).polluted, undefined, 'still clean after validation');
});

test('import with merge mode: existing data survives every garbage file', async () => {
  const { validateBackup, importBackup } = await import('../src/core/backup.js');
  const { idbPut } = await import('../src/core/storage.js');

  // Seed known-good data.
  await idbPut('workspaces', { id: 'keep-1', name: 'Precious', createdAt: 1, updatedAt: 9, tabs: [{ url: 'https://keep.example/', title: 'K' }] });

  const inputs = garbageInputs(120, 777);
  for (const input of inputs) {
    const v = validateBackup(input);
    if (v.ok) {
      try { await importBackup(v.data, { mode: 'merge' }); } catch (e) {
        assert.fail(`importBackup threw on valid-validated input: ${e.message}`);
      }
    }
    const { idbGet } = await import('../src/core/storage.js');
    const precious = await idbGet('workspaces', 'keep-1');
    assert.ok(precious, 'seeded workspace must survive (merge never deletes)');
    assert.equal(precious.name, 'Precious');
  }
});

test('corrupted storage read returns null/empty instead of crashing callers', async () => {
  const { idbGet, idbGetAll } = await import('../src/core/storage.js');
  // Reading from a store with no DB open yet resolves via lazy open.
  const ws = await idbGet('workspaces', 'missing');
  assert.equal(ws, null);
  const all = await idbGetAll('snapshots');
  assert.ok(Array.isArray(all));
});

test('storage write failure mid-snapshot leaves browser state untouched and old snapshots intact', async () => {
  const fc = globalThis.chrome;
  fc.seed({ windows: [[
    { url: 'https://mail.google.com/', title: 'Inbox' },
    { url: 'https://github.com/a', title: 'GH' }
  ]] });

  const { createSnapshot, listSnapshots } = await import('../src/core/snapshots.js');
  // First snapshot succeeds.
  await createSnapshot('manual');
  const before = await listSnapshots();
  assert.equal(before.length, 1);

  // Break the next write.
  const db = globalThis.indexedDB.open()._db;
  db.failNextWrite = true;
  await assert.rejects(() => createSnapshot('manual'));
  const after = await listSnapshots();
  assert.equal(after.length, 1, 'failed snapshot did not corrupt the store');
  assert.equal(after[0].id, before[0].id);
  // Browser state untouched (snapshotting never mutates tabs anyway).
  assert.equal(fc.tabRecords.size, 2);
});

test('restore of a hand-corrupted snapshot never throws raw errors to the caller path', async () => {
  const fc = globalThis.chrome;
  fc.seed({ windows: [[{ url: 'https://a.com/1' }]] });

  const { restoreSnapshot } = await import('../src/core/snapshots.js');
  const evil = {
    id: 'x', createdAt: Date.now(), trigger: 'imported', app: 'TabVault', version: 1,
    counts: { tabs: 3, windows: 2 }, truncated: false,
    windows: [
      null, // garbage window
      { id: 1, tabs: [{ url: 'https://ok.example/', title: 'ok', pinned: false, index: 0 }, null, { url: '', title: 'empty' }] },
      { id: 2, tabs: 'not-an-array' }, // garbage tabs
      { tabs: [{ url: 'https://also-ok.example/' }] } // missing id
    ]
  };
  // Must not throw; must do best-effort work and report counts.
  const res = await restoreSnapshot(evil);
  assert.ok(res.opened >= 2, `opened ${res.opened}`);
  assert.ok(fc.openUrls().has('https://ok.example/'));
  assert.ok(fc.openUrls().has('https://also-ok.example/'));
});

test('organize with tab ids that no longer exist skips them silently (closed mid-flight)', async () => {
  const fc = globalThis.chrome;
  fc.seed({ windows: [[
    { url: 'https://github.com/a', title: 'GH1' },
    { url: 'https://github.com/b', title: 'GH2' },
    { url: 'https://github.com/c', title: 'GH3' }
  ]] });
  const { getAllTabs } = await import('../src/core/tabs.js');
  const { organizeFromGroups } = await import('../src/core/organize.js');

  const tabs = await getAllTabs();
  const staleId = tabs[2].id;
  await fc.tabs.remove(staleId); // tab closed while user was reviewing

  const res = await organizeFromGroups([
    { name: 'Development', color: 'green', tabIds: [...tabs.map((t) => t.id)] }
  ]);
  assert.equal(res.failed.length, 0);
  assert.equal(res.tabsGrouped, 2, 'stale id skipped, live tabs grouped');
  assert.equal(fc.tabRecords.size, 2);
});

test('undo twice in a row: second undo reports NO_UNDO (no snapshot reuse)', async () => {
  const fc = globalThis.chrome;
  fc.seed({ windows: [[
    { url: 'https://mail.google.com/a' }, { url: 'https://github.com/b' }, { url: 'https://github.com/c' }
  ]] });
  const { getAllTabs } = await import('../src/core/tabs.js');
  const { analyzeTabs } = await import('../src/core/categorize.js');
  const { organizeFromGroups, undoLastOrganize } = await import('../src/core/organize.js');

  const tabs = await getAllTabs();
  const a = analyzeTabs(tabs, { minGroupSize: 2, preserveExistingGroups: true }, new Map());
  await organizeFromGroups(a.suggestions.map((s) => ({ name: s.name, color: s.color, tabIds: s.tabIds.slice() })));

  await undoLastOrganize(); // fine
  await assert.rejects(() => undoLastOrganize(), (e) => e.code === 'NO_UNDO');
});

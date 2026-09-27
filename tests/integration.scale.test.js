// Scale & performance stress tests. The bar: organizing 5,000+ tabs must
// never freeze (analysis is synchronous and must stay under hard budgets),
// and every batch write must complete without errors.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeChrome, installFakeIndexedDB, resetIds } from './helpers/fake-env.js';
import { generateTabs } from './helpers/url-cases.js';

beforeEach(() => {
  resetIds();
  installFakeIndexedDB();
  installFakeChrome();
});

function seedGenerated(fc, tabs, windows = 1) {
  const grouped = tabs.map((t, i) => ({ ...t, windowIndex: Math.min(t.windowIndex, windows - 1) }));
  const perWindow = Array.from({ length: windows }, () => []);
  for (const t of grouped) perWindow[t.windowIndex].push(t);
  // Real Chrome always keeps pinned tabs before unpinned ones in a window —
  // order each window's tabs that way so the seeded state is achievable.
  for (const list of perWindow) list.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
  fc.seed({ windows: perWindow });
}

test('2,000-tab analysis stays under a 500ms budget', async () => {
  const fc = globalThis.chrome;
  seedGenerated(fc, generateTabs(2000, { windows: 3 }), 3);

  const { getAllTabs } = await import('../src/core/tabs.js');
  const { analyzeTabs } = await import('../src/core/categorize.js');

  const tabs = await getAllTabs();
  const t0 = performance.now();
  const analysis = analyzeTabs(tabs, { minGroupSize: 2, preserveExistingGroups: true }, new Map());
  const ms = performance.now() - t0;

  assert.equal(analysis.stats.total, 2000);
  assert.ok(analysis.suggestions.length >= 3, 'major categories detected');
  assert.ok(ms < 500, `analysis took ${ms.toFixed(0)}ms (budget 500ms)`);
});

test('5,000-tab analysis stays under a 2s budget', async () => {
  const fc = globalThis.chrome;
  seedGenerated(fc, generateTabs(5000, { windows: 5, seed: 99 }), 5);

  const { getAllTabs } = await import('../src/core/tabs.js');
  const { analyzeTabs } = await import('../src/core/categorize.js');

  const tabs = await getAllTabs();
  const t0 = performance.now();
  const analysis = analyzeTabs(tabs, { minGroupSize: 2, preserveExistingGroups: true }, new Map());
  const ms = performance.now() - t0;

  assert.equal(analysis.stats.total, 5000);
  assert.ok(ms < 2000, `analysis took ${ms.toFixed(0)}ms (budget 2000ms)`);
});

test('1,000 duplicates detected with correct counts, under 300ms', async () => {
  const fc = globalThis.chrome;
  seedGenerated(fc, generateTabs(1500, { windows: 2, dupRate: 0.7, seed: 5 }), 2);

  const { getAllTabs } = await import('../src/core/tabs.js');
  const { findDuplicateGroups, countDuplicateTabs } = await import('../src/core/duplicates.js');

  const tabs = await getAllTabs();
  const t0 = performance.now();
  const groups = findDuplicateGroups(tabs);
  const ms = performance.now() - t0;

  const totalInGroups = groups.reduce((n, g) => n + g.tabs.length, 0);
  assert.ok(totalInGroups > 500, `expected heavy duplication, got ${totalInGroups}`);
  assert.equal(countDuplicateTabs(groups), totalInGroups - groups.length);
  assert.ok(ms < 300, `dup scan took ${ms.toFixed(0)}ms`);
});

test('organize 1,000+ tabs end-to-end: snapshot, group per window, undo — all exact', async () => {
  const fc = globalThis.chrome;
  seedGenerated(fc, generateTabs(1200, { windows: 2, dupRate: 0.1, seed: 11 }), 2);

  const { getAllTabs } = await import('../src/core/tabs.js');
  const { analyzeTabs } = await import('../src/core/categorize.js');
  const { organizeFromGroups, undoLastOrganize } = await import('../src/core/organize.js');

  const before = JSON.stringify(fc.layout());
  const t0 = performance.now();

  const tabs = await getAllTabs();
  const analysis = analyzeTabs(tabs, { minGroupSize: 2, preserveExistingGroups: true }, new Map());
  const groups = analysis.suggestions.map((s) => ({ name: s.name, color: s.color, tabIds: s.tabIds.slice() }));
  const res = await organizeFromGroups(groups);
  assert.equal(res.failed.length, 0);
  assert.ok(res.tabsGrouped > 800, `grouped ${res.tabsGrouped} of 1200`);

  await undoLastOrganize();

  const ms = performance.now() - t0;
  assert.equal(JSON.stringify(fc.layout()), before, 'undo restored 1,200-tab layout exactly');
  assert.ok(ms < 30_000, `full cycle took ${(ms / 1000).toFixed(1)}s`);
});

test('snapshot capture of 5,000 tabs stays within SNAPSHOT_MAX_TABS and completes', async () => {
  const fc = globalThis.chrome;
  seedGenerated(fc, generateTabs(5000, { windows: 4, seed: 21 }), 4);

  const { captureState } = await import('../src/core/snapshots.js');
  const t0 = performance.now();
  const snap = await captureState('test');
  const ms = performance.now() - t0;

  assert.equal(snap.counts.tabs, 5000);
  assert.equal(snap.counts.windows, 4);
  assert.ok(ms < 3000, `capture took ${ms.toFixed(0)}ms`);

  // And it round-trips through storage.
  const { createSnapshot, listSnapshots } = await import('../src/core/snapshots.js');
  const snap2 = await createSnapshot('manual');
  const all = await listSnapshots();
  assert.equal(all.length, 1);
  assert.equal(all[0].id, snap2.id);
  assert.equal(all[0].counts.tabs, 5000);
});

test('snapshot retention pruning keeps newest and respects the limit', async () => {
  const { pruneSnapshots, listSnapshots } = await import('../src/core/snapshots.js');
  const { idbPut } = await import('../src/core/storage.js');

  // Seed 40 snapshots directly with staggered timestamps (createSnapshot
  // prunes internally, so we write raw to control the population).
  const base = Date.now();
  for (let i = 0; i < 40; i++) {
    await idbPut('snapshots', {
      id: `snap-${i}`, createdAt: base - i * 1000, trigger: 'auto', app: 'TabVault', version: 1,
      counts: { tabs: 1, windows: 1 }, truncated: false,
      windows: [{ id: 1, type: 'normal', state: 'normal', tabs: [{ tabId: 1, url: 'https://a.com/', title: '', pinned: false, index: 0, groupId: -1, groupTitle: '', groupColor: '' }] }]
    });
  }
  const removed = await pruneSnapshots(30);
  assert.equal(removed, 10, 'oldest 10 pruned');
  const all = await listSnapshots();
  assert.equal(all.length, 30);
  assert.ok(all[0].createdAt >= all[1].createdAt, 'newest-first ordering');
  assert.equal(all[0].id, 'snap-0', 'newest snapshot kept');
});

test('search over 2,000 tabs is sub-50ms', async () => {
  const fc = globalThis.chrome;
  seedGenerated(fc, generateTabs(2000, { windows: 2 }), 2);

  const { getAllTabs, tabDescriptor } = await import('../src/core/tabs.js');
  const { searchTabs } = await import('../src/core/search.js');

  const descs = (await getAllTabs()).map(tabDescriptor);
  const t0 = performance.now();
  const hits = searchTabs('github', descs, new Map());
  const ms = performance.now() - t0;
  assert.ok(hits.length > 0);
  assert.ok(ms < 50, `search took ${ms.toFixed(1)}ms`);
});

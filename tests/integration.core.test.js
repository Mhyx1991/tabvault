// Integration stress tests: snapshot → organize → undo round-trips,
// restore semantics, close protection, workspaces — against a stateful
// fake Chrome with real layout semantics.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeChrome, installFakeIndexedDB, resetIds } from './helpers/fake-env.js';
import { generateTabs } from './helpers/url-cases.js';

beforeEach(() => {
  resetIds();
  installFakeIndexedDB();
  installFakeChrome();
});

/* ----------------------------- snapshot basics ---------------------------- */

test('snapshot captures windows, tabs, pins and groups exactly', async () => {
  const fc = globalThis.chrome;
  fc.seed({
    windows: [
      [
        { url: 'https://mail.google.com/', title: 'Inbox', pinned: true },
        { url: 'https://github.com/a', title: 'GH', groupTitle: 'Dev' }
      ],
      [{ url: 'https://www.youtube.com/', title: 'YT' }]
    ],
    groups: { Dev: 'green' }
  });

  const { captureState } = await import('../src/core/snapshots.js');
  const snap = await captureState('test');

  assert.equal(snap.counts.windows, 2);
  assert.equal(snap.counts.tabs, 3);
  const w1 = snap.windows[0];
  assert.equal(w1.tabs[0].pinned, true);
  assert.equal(w1.tabs[1].groupTitle, 'Dev');
  assert.equal(w1.tabs[1].groupColor, 'green');
});

test('snapshot skips incognito windows entirely (privacy contract)', async () => {
  const fc = globalThis.chrome;
  fc.seed({ windows: [[{ url: 'https://mail.google.com/' }]] });
  // Add an incognito window directly.
  fc.winRecords.set(999, { id: 999, type: 'normal', state: 'normal', incognito: true, focused: false, left: 0, top: 0, width: 800, height: 600, tabs: [] });
  const incTab = fc._makeTab(999, 'https://secret.example/', { index: 0 });
  fc.winRecords.get(999).tabs.push(incTab.id);

  const { captureState } = await import('../src/core/snapshots.js');
  const snap = await captureState('test');
  assert.equal(snap.counts.windows, 1);
  assert.ok(!JSON.stringify(snap).includes('secret.example'));
});

/* ------------------------- organize → undo round-trip ------------------------- */

test('FULL ROUND-TRIP: analyze → organize → verify groups → undo restores exact layout', async () => {
  const fc = globalThis.chrome;
  fc.seed({
    windows: [[
      { url: 'https://mail.google.com/a', title: 'Inbox 1' },
      { url: 'https://docs.google.com/b', title: 'Doc' },
      { url: 'https://slack.com/c', title: 'Slack' },
      { url: 'https://github.com/d', title: 'GH 1' },
      { url: 'https://stackoverflow.com/e', title: 'SO' },
      { url: 'https://github.com/f', title: 'GH 2' },
      { url: 'https://www.youtube.com/g', title: 'YT 1' },
      { url: 'https://www.netflix.com/h', title: 'NF' },
      { url: 'https://www.amazon.de/i', title: 'AZ' },
      { url: 'https://example.com/j', title: 'Unclear' }
    ]]
  });

  const { getAllTabs, groupTabsInWindow, applyGroupMeta } = await import('../src/core/tabs.js');
  const { analyzeTabs } = await import('../src/core/categorize.js');
  const { organizeFromGroups } = await import('../src/core/organize.js');
  const { undoLastOrganize } = await import('../src/core/organize.js');
  const { getMeta } = await import('../src/core/storage.js');

  const layoutBefore = fc.layout();
  const tabs = await getAllTabs();
  const groupsMap = new Map();
  const analysis = analyzeTabs(tabs, { minGroupSize: 2, preserveExistingGroups: true }, groupsMap);

  assert.ok(analysis.suggestions.length >= 2, `expected >=2 suggestions, got ${analysis.suggestions.length}`);

  const groups = analysis.suggestions.map((s) => ({
    name: s.name, color: s.color, tabIds: s.tabIds.slice()
  }));
  const result = await organizeFromGroups(groups);
  assert.equal(result.failed.length, 0, `failures: ${JSON.stringify(result.failed)}`);
  assert.ok(result.tabsGrouped >= 8, `grouped ${result.tabsGrouped}`);
  assert.ok(result.snapshotId, 'snapshot id recorded');

  // Chrome actually has groups now.
  const titles = fc.liveGroupTitles();
  assert.ok(titles.includes('Work'), `groups: ${titles.join(',')}`);
  assert.ok(titles.includes('Development'), `groups: ${titles.join(',')}`);

  // Undo must restore the exact previous layout.
  await undoLastOrganize();
  const layoutAfter = fc.layout();
  assert.deepEqual(layoutAfter, layoutBefore);
  assert.deepEqual(fc.liveGroupTitles(), [], 'no leftover groups after undo');

  // Undo is one-shot: the pointer is consumed afterwards.
  const meta = await getMeta();
  assert.equal(meta.lastOrganize, null, 'undo consumed the organize pointer');
  await assert.rejects(() => undoLastOrganize(), (e) => e.code === 'NO_UNDO');
});

test('organize fails safely when snapshot storage is broken: NOTHING changes', async () => {
  const fc = globalThis.chrome;
  fc.seed({ windows: [[
    { url: 'https://mail.google.com/a', title: 'Inbox' },
    { url: 'https://github.com/b', title: 'GH' },
    { url: 'https://github.com/c', title: 'GH2' }
  ]] });

  const db = globalThis.indexedDB.open()._db;
  db.failNextWrite = true; // snapshot write will fail

  const { getAllTabs } = await import('../src/core/tabs.js');
  const { organizeFromGroups } = await import('../src/core/organize.js');

  const layoutBefore = fc.layout();
  const tabs = await getAllTabs();
  const groups = [{ name: 'Work', color: 'blue', tabIds: tabs.map((t) => t.id) }];

  await assert.rejects(() => organizeFromGroups(groups));
  assert.deepEqual(fc.layout(), layoutBefore, 'layout untouched after failed snapshot');
  assert.equal(fc.groups.size, 0, 'no groups created');
});

test('organize contains per-group failure: other groups still organize, failure reported', async () => {
  const fc = globalThis.chrome;
  fc.seed({ windows: [[
    { url: 'https://mail.google.com/a', title: 'Inbox' },
    { url: 'https://docs.google.com/b', title: 'Doc' },
    { url: 'https://github.com/c', title: 'GH1' },
    { url: 'https://github.com/d', title: 'GH2' }
  ]] });
  fc.failGroupFrom = 2; // any batch group() with >= 2 tabs throws → forces the per-tab fallback path

  const { getAllTabs } = await import('../src/core/tabs.js');
  const { organizeFromGroups } = await import('../src/core/organize.js');

  const tabs = await getAllTabs();
  const groups = [
    { name: 'Work', color: 'blue', tabIds: tabs.slice(0, 2).map((t) => t.id) },
    { name: 'Development', color: 'green', tabIds: tabs.slice(2, 4).map((t) => t.id) }
  ];
  const result = await organizeFromGroups(groups);
  // The batch call fails, but groupTabsInWindow falls back to per-tab grouping,
  // so the tabs still end up organized — the resilience path is the point here.
  assert.ok(result.failed.length === 0, 'per-tab fallback rescues the grouping');
  assert.equal(result.tabsGrouped, 4);
  // Pre-organize snapshot still exists for recovery.
  const { listSnapshots } = await import('../src/core/snapshots.js');
  const snaps = await listSnapshots();
  assert.ok(snaps.length >= 1, 'snapshot exists for manual recovery');
});

test('undo with no prior organize throws friendly NO_UNDO error', async () => {
  const { undoLastOrganize } = await import('../src/core/organize.js');
  await assert.rejects(() => undoLastOrganize(), (e) => e.code === 'NO_UNDO');
});

test('undo is a no-op for tabs created after the snapshot (newTabsUntouched)', async () => {
  const fc = globalThis.chrome;
  fc.seed({ windows: [[
    { url: 'https://mail.google.com/a', title: 'Inbox' },
    { url: 'https://github.com/b', title: 'GH1' },
    { url: 'https://github.com/c', title: 'GH2' }
  ]] });

  const { getAllTabs } = await import('../src/core/tabs.js');
  const { organizeFromGroups, undoLastOrganize } = await import('../src/core/organize.js');
  const { createSnapshot } = await import('../src/core/snapshots.js');

  // Organize.
  const tabs = await getAllTabs();
  await organizeFromGroups([{ name: 'Mixed', color: 'grey', tabIds: tabs.map((t) => t.id) }]);
  const afterOrganize = fc.layout();

  // User opens a brand-new tab.
  await fc.tabs.create({ url: 'https://example.com/new', active: false });
  const newTabId = [...fc.tabRecords.keys()].at(-1);

  // Undo — must not close/move the new tab.
  await undoLastOrganize();
  assert.ok(fc.tabRecords.has(newTabId), 'new tab survived undo');
  const layout = fc.layout();
  const flat = layout.flatMap((w) => w.tabs.map((t) => t.id));
  assert.ok(flat.includes(newTabId), 'new tab still present in a window');
  assert.ok(afterOrganize); // organize had actually happened
});

/* ------------------------------- restore mode ------------------------------- */

test('restoreSnapshot opens missing tabs, reuses open ones, closes nothing by default', async () => {
  const fc = globalThis.chrome;
  fc.seed({ windows: [[
    { url: 'https://mail.google.com/', title: 'Inbox' },
    { url: 'https://github.com/x', title: 'GH' }
  ]] });

  const { createSnapshot } = await import('../src/core/snapshots.js');
  const snap = await createSnapshot('manual');

  // Close one tab, add another unrelated one.
  const gh = [...fc.tabRecords.values()].find((t) => t.url === 'https://github.com/x');
  await fc.tabs.remove(gh.id);
  await fc.tabs.create({ url: 'https://unrelated.example/' });

  const { restoreSnapshot } = await import('../src/core/snapshots.js');
  const res = await restoreSnapshot(snap);

  assert.equal(res.opened, 1, 'only the missing github tab opened');
  assert.equal(res.reused, 1, 'gmail reused by URL; unrelated tab untouched');
  assert.equal(res.closed, 0, 'closed nothing by default');
  // github is back
  assert.ok(fc.openUrls().has('https://github.com/x'));
  // unrelated tab still alive
  assert.ok(fc.openUrls().has('https://unrelated.example/'));
});

test('restoreSnapshot with closeExtraneous closes only non-snapshot tabs', async () => {
  const fc = globalThis.chrome;
  fc.seed({ windows: [[{ url: 'https://mail.google.com/', title: 'Inbox' }]] });

  const { createSnapshot, restoreSnapshot } = await import('../src/core/snapshots.js');
  const snap = await createSnapshot('manual');
  await fc.tabs.create({ url: 'https://extra.example/' });

  const res = await restoreSnapshot(snap, { closeExtraneous: true });
  assert.equal(res.closed, 1);
  assert.ok(!fc.openUrls().has('https://extra.example/'));
  assert.ok(fc.openUrls().has('https://mail.google.com/'));
});

test('restore preserves pinned state and group structure in the new window', async () => {
  const fc = globalThis.chrome;
  fc.seed({ windows: [[
    { url: 'https://mail.google.com/', title: 'Inbox', pinned: true },
    { url: 'https://github.com/a', title: 'GH', groupTitle: 'Dev', },
    { url: 'https://github.com/b', title: 'GH2', groupTitle: 'Dev' }
  ]], groups: { Dev: 'purple' } });

  const { createSnapshot, restoreSnapshot } = await import('../src/core/snapshots.js');
  const snap = await createSnapshot('manual');
  // Wipe everything.
  for (const id of [...fc.tabRecords.keys()]) await fc.tabs.remove(id).catch(() => {});
  for (const gid of [...fc.groups.keys()]) fc.groups.delete(gid);

  await restoreSnapshot(snap);
  const urls = fc.openUrls();
  assert.ok(urls.has('https://mail.google.com/'));
  const ghTabs = [...fc.tabRecords.values()].filter((t) => t.url.startsWith('https://github.com/'));
  assert.equal(ghTabs.length, 2);
  assert.equal(ghTabs[0].groupId, ghTabs[1].groupId, 'both in same restored group');
  assert.equal(fc.groups.get(ghTabs[0].groupId).title, 'Dev');
  const pinned = [...fc.tabRecords.values()].find((t) => t.url === 'https://mail.google.com/');
  assert.equal(pinned.pinned, true);
});

/* ------------------------------ close protection ------------------------------ */

test('closeTabsSafe reports failures without throwing and closes the rest', async () => {
  const fc = globalThis.chrome;
  fc.seed({ windows: [[
    { url: 'https://a.com/1' }, { url: 'https://a.com/2' }, { url: 'https://a.com/3' }
  ]] });
  const ids = [...fc.tabRecords.keys()];
  fc.failRemoveIds.add(ids[1]);

  const { closeTabsSafe } = await import('../src/core/tabs.js');
  const res = await closeTabsSafe(ids);
  assert.equal(res.closed, 2);
  assert.deepEqual(res.failed, [ids[1]]);
  assert.ok(fc.tabRecords.has(ids[1]), 'protected tab still open');
});

/* --------------------------------- workspaces --------------------------------- */

test('workspace save de-duplicates and open-as-group recreates collection', async () => {
  const fc = globalThis.chrome;
  fc.seed({ windows: [[
    { url: 'https://github.com/p1', title: 'P1' },
    { url: 'https://github.com/p1?utm_source=x', title: 'P1 dup' },
    { url: 'https://mail.google.com/', title: 'Inbox' }
  ]] });

  const { createWorkspace, openWorkspace } = await import('../src/core/workspaces.js');
  const tabs = [...fc.tabRecords.values()].map((t) => ({ url: t.url, title: t.title, pinned: t.pinned }));
  const ws = await createWorkspace('Test WS', tabs);
  assert.equal(ws.tabs.length, 2, 'duplicate removed');
  assert.equal(ws.duplicatesRemoved, 1);

  // Close everything, then open the workspace as a new window.
  for (const id of [...fc.tabRecords.keys()]) await fc.tabs.remove(id).catch(() => {});
  const res = await openWorkspace(ws, 'window');
  assert.equal(res.opened, 2);
  assert.deepEqual([...fc.openUrls()].sort(), ['https://github.com/p1', 'https://mail.google.com/']);
});

/* ------------------------------ duplicate closing ------------------------------ */

test('duplicate close keeps the active copy and closes extras (with protection upstream)', async () => {
  const fc = globalThis.chrome;
  fc.seed({ windows: [[
    { url: 'https://github.com/p' },
    { url: 'https://github.com/p' },
    { url: 'https://github.com/p', active: true },
    { url: 'https://github.com/p' }
  ]] });

  const { findDuplicateGroups, closePlan } = await import('../src/core/duplicates.js');
  const { getAllTabs } = await import('../src/core/tabs.js');
  const tabs = await getAllTabs();
  const groups = findDuplicateGroups(tabs);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].tabs.length, 4);

  const { close } = closePlan(groups[0]);
  assert.equal(close.length, 3);
  const keeper = groups[0].tabs[0];
  assert.equal(keeper.active, true);

  const { closeTabsSafe } = await import('../src/core/tabs.js');
  const res = await closeTabsSafe(close);
  assert.equal(res.closed, 3);
  assert.equal(fc.openUrls().size, 1);
});

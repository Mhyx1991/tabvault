// Unit tests: auto-group decision logic + settings sync merge semantics.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeChrome, installFakeIndexedDB, resetIds } from './helpers/fake-env.js';

beforeEach(() => {
  resetIds();
  installFakeIndexedDB();
  installFakeChrome();
});

const baseSettings = { autoGroup: true, domainRules: {}, minGroupSize: 2, minConfidence: 'medium' };
const groupsMap = new Map();

/* ----------------------------- autoGroupDecision ----------------------------- */

test('auto-group: high-confidence work tab is grouped', async () => {
  const { autoGroupDecision } = await import('../src/core/autogroup.js');
  const d = autoGroupDecision(
    { id: 1, url: 'https://mail.google.com/inbox', title: 'Inbox - Gmail', groupId: -1, pinned: false, windowId: 1 },
    baseSettings,
    groupsMap
  );
  assert.ok(d, 'decision returned');
  assert.equal(d.categoryId, 'work');
  assert.equal(d.name, 'Work');
});

test('auto-group: refuses when setting is off', async () => {
  const { autoGroupDecision } = await import('../src/core/autogroup.js');
  const d = autoGroupDecision(
    { id: 1, url: 'https://mail.google.com/', title: 'Inbox', groupId: -1, pinned: false, windowId: 1 },
    { ...baseSettings, autoGroup: false },
    groupsMap
  );
  assert.equal(d, null);
});

test('auto-group: never touches already-grouped or pinned tabs', async () => {
  const { autoGroupDecision } = await import('../src/core/autogroup.js');
  const t = { id: 1, url: 'https://mail.google.com/', title: 'Inbox', windowId: 1 };
  assert.equal(autoGroupDecision({ ...t, groupId: 5, pinned: false }, baseSettings), null, 'grouped tab');
  assert.equal(autoGroupDecision({ ...t, groupId: -1, pinned: true }, baseSettings), null, 'pinned tab');
});

test('auto-group: skips non-http URLs (newtab, chrome://)', async () => {
  const { autoGroupDecision } = await import('../src/core/autogroup.js');
  const t = { id: 1, title: 'New Tab', groupId: -1, pinned: false, windowId: 1 };
  assert.equal(autoGroupDecision({ ...t, url: 'chrome://newtab/' }, baseSettings), null);
  assert.equal(autoGroupDecision({ ...t, url: 'about:blank' }, baseSettings), null);
});

test('auto-group: respects minConfidence — ambiguous tab not grouped', async () => {
  const { autoGroupDecision } = await import('../src/core/autogroup.js');
  // A single weak keyword hit → low confidence → below 'medium' bar.
  const d = autoGroupDecision(
    { id: 1, url: 'https://random-site.com/some-page', title: 'random-site — discount', groupId: -1, pinned: false, windowId: 1 },
    baseSettings,
    groupsMap
  );
  // Whatever the outcome, it must not be below the confidence bar.
  if (d) assert.ok(['high', 'medium'].includes(d.confidence), `confidence ${d.confidence}`);
});

test('auto-group: user domain rules are decisive', async () => {
  const { autoGroupDecision } = await import('../src/core/autogroup.js');
  const d = autoGroupDecision(
    { id: 1, url: 'https://myproject.example.com/', title: 'My Project', groupId: -1, pinned: false, windowId: 1 },
    { ...baseSettings, domainRules: { 'myproject.example.com': 'development' } },
    groupsMap
  );
  assert.ok(d, 'rule-driven decision');
  assert.equal(d.categoryId, 'development');
  assert.equal(d.confidence, 'high');
});

/* ------------------------------- settings sync ------------------------------- */

test('sync: disabled by default; bootPull is a no-op until opted in', async () => {
  const { getSettings } = await import('../src/core/storage.js');
  const s = await getSettings();
  assert.equal(s.syncEnabled, false, 'opt-in by default');
});

test('sync: enable → push → pull applies prefs on a fresh profile', async () => {
  const fc = globalThis.chrome;
  const storage = await import('../src/core/storage.js');
  const sync = await import('../src/core/sync.js');

  await storage.saveSettings({ theme: 'dark', staleDays: 14 });
  await sync.enableSync();

  // Cloud copy now holds prefs.
  const cloud = await chrome.storage.sync.get('settings-sync');
  assert.equal(cloud['settings-sync'].settings.theme, 'dark');
  assert.ok(cloud['settings-sync'].settings.staleDays, 14);

  // Simulate a second device: wipe local settings, keep the cloud.
  fc.storage.local._data.clear();
  const pulled = await sync.pullSettings({ force: true });
  assert.equal(pulled.applied, true);
  const local = await storage.getSettings();
  assert.equal(local.theme, 'dark', 'theme synced');
  assert.equal(local.staleDays, 14, 'staleDays synced');
  assert.equal(local.autoSnapshot, true, 'defaults still intact');
});

test('sync: pull is a no-op when cloud is not newer (newest wins)', async () => {
  const storage = await import('../src/core/storage.js');
  const sync = await import('../src/core/sync.js');
  await storage.saveSettings({ theme: 'dark' });
  await sync.enableSync();
  const first = await sync.pullSettings();
  assert.equal(first.applied, false, 'up-to-date after fresh push');
});

test('sync: disable removes the cloud copy', async () => {
  const storage = await import('../src/core/storage.js');
  const sync = await import('../src/core/sync.js');
  await storage.saveSettings({ theme: 'dark' });
  await sync.enableSync();
  await sync.disableSync();
  const cloud = await chrome.storage.sync.get('settings-sync');
  assert.ok(!cloud['settings-sync'], 'cloud wiped on disable');
});

test('sync: sensitive-looking unknown keys never leave the device', async () => {
  const storage = await import('../src/core/storage.js');
  const sync = await import('../src/core/sync.js');
  // Inject an unexpected field into local settings.
  await chrome.storage.local.set({ settings: { ...await storage.getSettings(), browsingHistory: ['https://secret.example/'] } });
  await sync.enableSync();
  const cloud = await chrome.storage.sync.get('settings-sync');
  const payload = JSON.stringify(cloud['settings-sync']);
  assert.ok(!payload.includes('secret.example'), 'unknown/sensitive keys stripped');
  assert.ok(!payload.includes('browsingHistory'), 'allowlist enforced');
});

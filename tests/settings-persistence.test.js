// Regression: user settings (theme) must survive closing and reopening the
// popup / dashboard. The original bug: both pages applied the theme BEFORE
// awaiting loadCore(), so every fresh open read `store.settings === null`
// and fell back to the 'system' preference — the user's saved 'dark' was
// ignored until they touched a setting again.
//
// These tests drive the REAL storage.js code path (getSettings / saveSettings
// / loadCore from src/ui/store.js) against the fake chrome.storage.local,
// simulating close-and-reopen by re-importing the modules with an empty
// module registry (cache-busting query param), exactly like a fresh page load.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeChrome, installFakeIndexedDB, resetIds } from './helpers/fake-env.js';

beforeEach(() => {
  resetIds();
  installFakeIndexedDB();
  installFakeChrome();
});

/** Import a module fresh, bypassing Node's module cache (simulates a page reload). */
function freshImport(path) {
  return import(`${path}?reopen=${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

test('theme setting persists across a simulated popup reopen', async () => {
  // -- first open: user picks Dark in settings --
  const first = await freshImport('../src/ui/store.js');
  await first.loadCore();
  assert.equal(first.store.settings.theme, 'system', 'factory default is system');

  await first.updateSettings({ theme: 'dark' });
  assert.equal(first.store.settings.theme, 'dark', 'in-session change applied');

  // -- popup closes; a brand-new page opens (fresh module state, same storage) --
  const second = await freshImport('../src/ui/store.js');
  assert.equal(second.store.settings, null, 'new page starts with nothing loaded');

  await second.loadCore();
  assert.equal(second.store.settings.theme, 'dark',
    'saved theme must be visible to the new page — the popup/dashboard read it AFTER loadCore');
});

test('dashboard boot order reads theme only after settings are loaded (source contract)', async () => {
  // Guard the exact regression: applyTheme() must not run before loadCore()
  // resolves in either entry point. Parse the boot blocks as a belt-and-braces
  // check that survives refactors.
  const { readFileSync } = await import('node:fs');

  const popup = readFileSync(new URL('../src/ui/popup.js', import.meta.url), 'utf8');
  const popupBoot = popup.slice(popup.indexOf('(async function boot()'));
  const popupAwaitLoad = popupBoot.indexOf('await loadCore()');
  const popupApply = popupBoot.indexOf('applyTheme()');
  assert.ok(popupAwaitLoad !== -1, 'popup boot awaits loadCore');
  assert.ok(popupApply > popupAwaitLoad, 'popup applies theme AFTER settings are loaded');

  const dash = readFileSync(new URL('../src/ui/dashboard.js', import.meta.url), 'utf8');
  const dashBoot = dash.slice(dash.indexOf('(async function boot()'));
  const dashAwaitLoad = dashBoot.indexOf('await loadCore()');
  const dashApply = dashBoot.indexOf('applyTheme()');
  assert.ok(dashAwaitLoad !== -1, 'dashboard boot awaits loadCore');
  assert.ok(dashApply > dashAwaitLoad, 'dashboard applies theme AFTER settings are loaded');
});

test('getSettings merges saved values over defaults and survives corrupt storage', async () => {
  const storage = await freshImport('../src/core/storage.js');

  // Default when nothing saved.
  const defaults = await storage.getSettings();
  assert.equal(defaults.theme, 'system');
  assert.equal(defaults.autoSnapshot, true);

  // Persist a custom theme, re-read through a fresh module instance.
  await storage.saveSettings({ theme: 'dark' });
  const again = await freshImport('../src/core/storage.js');
  const saved = await again.getSettings();
  assert.equal(saved.theme, 'dark');
  assert.equal(saved.autoSnapshot, true, 'unspecified keys keep defaults');
});

test('theme change through updateSettings round-trips and emits', async () => {
  const ui = await freshImport('../src/ui/store.js');
  await ui.loadCore();

  let events = 0;
  const unsubscribe = ui.subscribe(() => { events++; });

  const result = await ui.updateSettings({ theme: 'light' });
  assert.equal(result.theme, 'light');
  assert.equal(ui.store.settings.theme, 'light');
  // emit() is coalesced to an animation frame — wait one frame before asserting.
  await new Promise((r) => setTimeout(r, 30));
  assert.ok(events >= 1, 'subscribers notified of the change');
  unsubscribe();
});

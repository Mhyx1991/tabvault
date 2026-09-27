// Dev-only smoke test: import every module with a stubbed chrome API to catch
// broken import graphs, circular imports and top-level crashes. Not shipped.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const listener = { addListener() {} };

globalThis.chrome = {
  runtime: {
    getURL: (p) => 'chrome-extension://tabvault-test' + (p || '/'),
    getManifest: () => ({ version: '1.0.0', manifest_version: 3 }),
    onInstalled: listener, onStartup: listener, onMessage: listener
  },
  storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} } },
  alarms: { create: async () => {}, onAlarm: listener },
  sidePanel: { open: async () => {} },
  tabs: { query: async () => [], group: async () => 1, onCreated: listener, onUpdated: listener, onRemoved: listener, onMoved: listener, onAttached: listener, onDetached: listener },
  windows: { getAll: async () => [], getLastFocused: async () => ({ id: 1 }), onCreated: listener, onRemoved: listener },
  tabGroups: { query: async () => [], onUpdated: listener, onRemoved: listener }
};

test('all entry modules import cleanly (graph + top-level check)', async () => {
  const core = await import('../src/core/categorize.js');
  assert.ok(typeof core.analyzeTabs === 'function');
  await import('../src/core/duplicates.js');
  await import('../src/core/stale.js');
  await import('../src/core/search.js');
  await import('../src/core/snapshots.js');
  await import('../src/core/organize.js');
  await import('../src/core/workspaces.js');
  await import('../src/core/backup.js');
  await import('../src/core/storage.js');
  await import('../src/core/tabs.js');
  await import('../src/background/service-worker.js');
  assert.ok(true);
});

test('UI modules import cleanly', async () => {
  await import('../src/ui/store.js');
  await import('../src/ui/components.js');
  await import('../src/ui/flows.js');
  await import('../src/ui/views/overview.js');
  await import('../src/ui/views/suggestions.js');
  await import('../src/ui/views/workspaces.js');
  await import('../src/ui/views/history.js');
  await import('../src/ui/views/care.js');
  await import('../src/ui/views/settings.js');
  await import('../src/ui/views/privacy.js');
  assert.ok(true);
});

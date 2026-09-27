// Screenshot harness boot — seeds IndexedDB (snapshots + workspaces) the way
// core/storage.js would, then loads the real dashboard.js. Runs as a module
// so it executes after the inline stub script and before dashboard render.
//
// Seed contents:
//  - 3 snapshots (yesterday pre-organize, 3 days ago auto, 5 days ago pre-stash)
//  - 3 workspaces (Side project, Research, Weekend)

const DB_NAME = 'tabvault';
const DB_VERSION = 1;
const STORES = { SNAPSHOTS: 'snapshots', WORKSPACES: 'workspaces', KV: 'kv' };

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORES.SNAPSHOTS)) {
        const s = db.createObjectStore(STORES.SNAPSHOTS, { keyPath: 'id' });
        s.createIndex('createdAt', 'createdAt');
      }
      if (!db.objectStoreNames.contains(STORES.WORKSPACES)) {
        const s = db.createObjectStore(STORES.WORKSPACES, { keyPath: 'id' });
        s.createIndex('updatedAt', 'updatedAt');
      }
      if (!db.objectStoreNames.contains(STORES.KV)) {
        db.createObjectStore(STORES.KV, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function put(db, storeName, value) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeName, 'readwrite');
    t.objectStore(storeName).put(value);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

const now = Date.now();
const H = 3600000;
const day = 86400000;

function entry(url, title, groupId = -1, groupTitle = '', groupColor = '', extra = {}) {
  return { tabId: 0, url, title, pinned: false, index: 0, groupId, groupTitle, groupColor, ...extra };
}

// A "before organizing" snapshot: the same tabs, ungrouped.
function snap(id, createdAt, trigger, windows) {
  let total = 0;
  for (const w of windows) total += w.tabs.length;
  return {
    id, createdAt, trigger, app: 'TabVault', version: 1,
    counts: { tabs: total, windows: windows.length },
    truncated: false,
    windows: windows.map((w, wi) => ({ id: wi + 1, type: 'normal', state: 'normal', left: 0, top: 0, width: 1280, height: 800, focused: wi === 0, tabs: w.tabs.map((t, ti) => ({ ...t, tabId: 100 + wi * 20 + ti, index: ti })) }))
  };
}

const beforeOrganize = snap('seed-snap-1', now - 26 * H, 'pre-organize', [
  { tabs: [
    entry('https://mail.google.com/mail/u/0/#inbox', 'Inbox (12) — Gmail', -1, '', '', { pinned: true }),
    entry('https://docs.google.com/document/d/quarterly-planning/edit', 'Q3 Planning — Quarterly Planning'),
    entry('https://calendar.google.com/calendar/u/0/r/week', 'Calendar — Week of 21 September'),
    entry('https://github.com/marcus/tabvault/pull/42', 'tabvault: PR #42 review'),
    entry('https://stackoverflow.com/questions/9999/typeerror-undefined', 'TypeError: cannot read properties of undefined'),
    entry('https://developer.chrome.com/docs/extensions/reference/sidePanel', 'sidePanel - Chrome Developers'),
    entry('https://www.youtube.com/watch?v=lofi', 'Lo-fi beats to code to'),
    entry('https://open.spotify.com/playlist/focus', 'Deep Focus — Spotify'),
    entry('https://www.amazon.de/dp/B0USBC-HUB', 'USB-C hub — Amazon'),
    entry('https://news.ycombinator.com/', 'Hacker News')
  ] },
  { tabs: [
    entry('https://arxiv.org/abs/2401.12345', 'Attention Is All You Need revisited'),
    entry('https://www.wikipedia.org/wiki/Attention_(machine_learning)', 'Attention (machine learning) — Wikipedia')
  ] }
]);

const autoSnapshot = snap('seed-snap-2', now - 3 * day - 5 * H, 'auto', [
  { tabs: [
    entry('https://mail.google.com/mail/u/0/#inbox', 'Inbox (8) — Gmail', -1, '', '', { pinned: true }),
    entry('https://docs.google.com/document/d/quarterly-planning/edit', 'Q3 Planning — Quarterly Planning'),
    entry('https://github.com/marcus/tabvault/pull/42', 'tabvault: PR #42 review'),
    entry('https://www.youtube.com/watch?v=lofi', 'Lo-fi beats to code to'),
    entry('https://news.ycombinator.com/', 'Hacker News')
  ] }
]);

const preStash = snap('seed-snap-3', now - 5 * day - 2 * H, 'pre-stash', [
  { tabs: [
    entry('https://mail.google.com/mail/u/0/#inbox', 'Inbox (3) — Gmail', -1, '', '', { pinned: true }),
    entry('https://github.com/marcus/tabvault', 'tabvault: build a tab organizer'),
    entry('https://developer.chrome.com/docs/extensions/mv3/intro', 'What is MV3? - Chrome Developers')
  ] }
]);

const workspaces = [
  { id: 'seed-ws-1', name: 'Side project', createdAt: now - 6 * day, updatedAt: now - 2 * H, source: 'selection', color: 'blue', tabs: [
    { url: 'https://github.com/marcus/tabvault', title: 'tabvault: build a tab organizer', pinned: false },
    { url: 'https://developer.chrome.com/docs/extensions/mv3/intro', title: 'MV3 overview - Chrome Developers', pinned: false },
    { url: 'https://stackoverflow.com/questions/tagged/chrome-extension', title: 'Newest chrome-extension questions', pinned: false }
  ], duplicatesRemoved: 0 },
  { id: 'seed-ws-2', name: 'Research', createdAt: now - 9 * day, updatedAt: now - day, source: 'manual', color: 'purple', tabs: [
    { url: 'https://arxiv.org/abs/2401.12345', title: 'Attention Is All You Need revisited', pinned: false },
    { url: 'https://www.wikipedia.org/wiki/Attention_(machine_learning)', title: 'Attention (machine learning) — Wikipedia', pinned: false }
  ], duplicatesRemoved: 0 },
  { id: 'seed-ws-3', name: 'Weekend', createdAt: now - 14 * day, updatedAt: now - 2 * day, source: 'manual', color: 'orange', tabs: [
    { url: 'https://www.youtube.com/watch?v=lofi', title: 'Lo-fi beats to code to', pinned: false },
    { url: 'https://news.ycombinator.com/', title: 'Hacker News', pinned: false }
  ], duplicatesRemoved: 0 }
];

(async () => {
  const marker = document.createElement('div');
  marker.id = 'seed-status';
  marker.style.display = 'none';
  document.body.appendChild(marker);
  try {
    const db = await openDB();
    await put(db, STORES.SNAPSHOTS, beforeOrganize);
    await put(db, STORES.SNAPSHOTS, autoSnapshot);
    await put(db, STORES.SNAPSHOTS, preStash);
    for (const ws of workspaces) await put(db, STORES.WORKSPACES, ws);
    marker.dataset.status = 'seeded';
  } catch (e) {
    window.__qa.errors.push('seed: ' + String(e));
    marker.dataset.status = 'seed-failed: ' + String(e);
  }
  const params = new URLSearchParams(location.search);
  const view = params.get('view') || 'overview';
  if (('#' + view) !== location.hash) location.hash = '#' + view;
  try {
    await import('../../src/ui/dashboard.js');
    marker.dataset.status = (marker.dataset.status || '') + ' booted';
  } catch (e) {
    marker.dataset.status = (marker.dataset.status || '') + ' boot-failed: ' + String(e);
  }
  window.__qa.ready = true;
})();

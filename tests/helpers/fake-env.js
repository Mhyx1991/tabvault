// Stateful fake Chrome + IndexedDB for integration stress tests.
// Simulates real browser semantics: tab ids persist, moves change indices,
// grouping assigns a shared groupId, removing tabs updates windows.
// NOT shipped with the extension.

/* ------------------------------- fake IDB -------------------------------- */

export class FakeIDBRequest {
  constructor(result) {
    this.result = result;
    this.error = null;
    this.onsuccess = null;
    this.onerror = null;
    queueMicrotask(() => { if (this.onsuccess) this.onsuccess({ target: this }); });
  }
}

export class FakeIDBIndex {
  constructor(store, name) {
    this._store = store;
    this.name = name;
  }
  getAll() {
    return new FakeIDBRequest([...this._store.records.values()]);
  }
}

export class FakeIDBObjectStore {
  constructor(db, name, tx) {
    this._db = db;
    this.name = name;
    this._tx = tx;
    this.indexNames = { contains: (n) => ['createdAt', 'updatedAt'].includes(n) };
  }
  index(name) {
    return new FakeIDBIndex(this._db.stores[this.name], name);
  }
  put(value) {
    if (this._db.failNextWrite) {
      this._db.failNextWrite = false;
      const err = new Error('QuotaExceededError');
      // Real IDB: the request error aborts the transaction synchronously —
      // before any oncomplete can fire.
      this._tx.error = err;
      queueMicrotask(() => { this._tx.onerror?.(err); this._tx.onabort?.(err); });
      return new FakeIDBRequest(undefined);
    }
    const recs = this._db.stores[this.name];
    if (value && typeof value === 'object' && recs.keyPath) {
      recs.records.set(value[recs.keyPath], value);
    } else {
      recs.records.set(value.key ?? recs.records.size, value);
    }
    return new FakeIDBRequest(value);
  }
  get(key) {
    return new FakeIDBRequest(this._db.stores[this.name].records.get(key));
  }
  getAll() {
    return new FakeIDBRequest([...this._db.stores[this.name].records.values()]);
  }
  delete(key) {
    this._db.stores[this.name].records.delete(key);
    return new FakeIDBRequest(undefined);
  }
  clear() {
    this._db.stores[this.name].records.clear();
    return new FakeIDBRequest(undefined);
  }
}

export class FakeIDBTransaction {
  constructor(db, storeNames) {
    this._db = db;
    this.stores = {};
    this.error = null;
    this.oncomplete = null;
    this.onerror = null;
    this.onabort = null;
    for (const name of storeNames) this.stores[name] = new FakeIDBObjectStore(db, name, this);
    queueMicrotask(() => {
      // Errors are set synchronously during fn(store), so by the time this
      // microtask runs we know whether the transaction is doomed.
      if (!this.error && this.oncomplete) this.oncomplete({});
    });
  }
  objectStore(name) {
    return this.stores[name];
  }
  abort() {
    this.error = new Error('Transaction aborted');
    this.onabort?.(this.error);
  }
}

export class FakeIDBDatabase {
  constructor() {
    this.stores = {
      snapshots: { records: new Map(), keyPath: 'id' },
      workspaces: { records: new Map(), keyPath: 'id' },
      kv: { records: new Map(), keyPath: 'key' }
    };
    this.failNextWrite = false;
  }
  get objectStoreNames() {
    const names = Object.keys(this.stores);
    return { contains: (n) => names.includes(n) };
  }
  transaction(storeNames) {
    return new FakeIDBTransaction(this, [].concat(storeNames));
  }
}

let _singletonDB = null;

export function installFakeIndexedDB() {
  // One singleton per process: storage.js caches the opened DB in module
  // state, so every test must share (and reset) the same instance.
  if (!_singletonDB) _singletonDB = new FakeIDBDatabase();
  const db = _singletonDB;
  for (const store of Object.values(db.stores)) store.records.clear();
  db.failNextWrite = false;
  globalThis.indexedDB = {
    open() {
      const req = new FakeIDBRequest(db);
      req._db = db;
      queueMicrotask(() => { if (req.onupgradeneeded) req.onupgradeneeded({ target: req }); });
      queueMicrotask(() => { if (req.onsuccess) req.onsuccess({ target: req }); });
      return req;
    }
  };
  return db;
}

/* ------------------------------ fake chrome ------------------------------ */

let nextTabId = 1;
let nextWinId = 1;
let nextGroupId = 1;

export class FakeChrome {
  constructor() {
    this.tabRecords = new Map(); // id → tab record (chrome.tabs.* is the API below)
    this.winRecords = new Map();    // id → { id, type, state, incognito, focused, left, top, width, height, tabs:[] }
    this.groups = new Map();     // id → { id, title, color, windowId }
    this.listeners = [];
    this.failGroupFrom = null;   // number: fail chrome.tabs.group calls with >= N tabIds
    this.failRemoveIds = new Set();
    this.alarmPeriod = null;
    const listener = { addListener: () => {} };
    this.runtime = {
      getURL: (p) => 'chrome-extension://tabvault-test' + (p || '/'),
      getManifest: () => ({ version: '1.1.0', manifest_version: 3 }),
      id: 'tabvault-test-id',
      onInstalled: listener, onStartup: listener, onMessage: listener,
      sendMessage: async () => ({})
    };
    this.storage = {
      local: {
        _data: new Map(),
        get: async (keys) => {
          const out = {};
          for (const k of [].concat(keys)) if (this.storage.local._data.has(k)) out[k] = this.storage.local._data.get(k);
          return out;
        },
        set: async (obj) => { for (const [k, v] of Object.entries(obj)) this.storage.local._data.set(k, v); },
        remove: async (keys) => { for (const k of [].concat(keys)) this.storage.local._data.delete(k); }
      },
      sync: {
        _data: new Map(),
        get: async (keys) => {
          const out = {};
          for (const k of [].concat(keys)) if (this.storage.sync._data.has(k)) out[k] = this.storage.sync._data.get(k);
          return out;
        },
        set: async (obj) => { for (const [k, v] of Object.entries(obj)) this.storage.sync._data.set(k, v); },
        remove: async (keys) => { for (const k of [].concat(keys)) this.storage.sync._data.delete(k); }
      }
    };
    this.alarms = { create: async (name, info) => { this.alarmPeriod = info.periodInMinutes; }, onAlarm: listener };
    this.action = {
      _badge: '',
      _title: '',
      setBadgeText: async ({ text }) => { this.action._badge = text; },
      setBadgeBackgroundColor: async () => {},
      setTitle: async ({ title }) => { this.action._title = title; }
    };
    this.tabs = {
      query: async (q = {}) => this._queryTabs(q),
      get: async (id) => this._tabOrThrow(id),
      create: async ({ windowId, url, index, active, pinned }) => {
        const wid = windowId ?? [...this.winRecords.keys()].at(-1) ?? this._addWindow({}).id;
        const w = this.winRecords.get(wid);
        const t = this._makeTab(wid, url ?? 'about:blank', { index: index ?? w.tabs.length, active: !!active, pinned: !!pinned });
        w.tabs.push(t.id);
        return { ...t };
      },
      remove: async (ids) => {
        for (const id of [].concat(ids)) {
          if (this.failRemoveIds.has(id)) throw new Error('Cannot remove tab protected by Chrome');
          if (!this.tabRecords.has(id)) throw new Error(`No tab with id: ${id}`);
          const t = this.tabRecords.get(id);
          const w = this.winRecords.get(t.windowId);
          if (w) w.tabs = w.tabs.filter((x) => x !== id);
          this.tabRecords.delete(id);
        }
      },
      discard: async (id) => {
        const t = this._tabOrThrow(id);
        this.tabRecords.get(id).discarded = true;
        return { ...t };
      },
      update: async (id, props) => {
        const t = this._tabOrThrow(id);
        Object.assign(this.tabRecords.get(id), props);
        return { ...t };
      },
      move: async (ids, { windowId, index }) => {
        for (const id of [].concat(ids)) {
          const t = this._tabOrThrow(id); // read-only check + copy
          const from = this.winRecords.get(t.windowId);
          from.tabs = from.tabs.filter((x) => x !== id);
          const to = this.winRecords.get(windowId);
          if (!to) throw new Error('No window with that id');
          const idx = index >= 0 && index <= to.tabs.length ? index : to.tabs.length;
          to.tabs.splice(idx, 0, id);
          this.tabRecords.get(id).windowId = windowId;
        }
        this._reindex();
        return [];
      },
      group: async ({ tabIds, createProperties }) => {
        if (this.failGroupFrom != null && tabIds.length >= this.failGroupFrom) {
          throw new Error('Cannot create a group with the given tabs');
        }
        const gid = nextGroupId++;
        const first = this._tabOrThrow(tabIds[0]);
        this.groups.set(gid, { id: gid, title: '', color: 'grey', windowId: createProperties?.windowId ?? first.windowId });
        for (const id of tabIds) {
          const t = this._tabOrThrow(id); // read-only check + copy
          if (t.groupId !== -1) this._ungroupRecord(id);
          const from = this.winRecords.get(t.windowId);
          from.tabs = from.tabs.filter((x) => x !== id);
          const to = this.winRecords.get(createProperties?.windowId ?? first.windowId);
          to.tabs.push(id);
          const rec = this.tabRecords.get(id);
          rec.windowId = to.id;
          rec.groupId = gid;
        }
        this._reindex();
        return gid;
      },
      ungroup: async (ids) => {
        for (const id of [].concat(ids)) {
          this._ungroupRecord(id);
        }
        this._reindex();
      },
      onCreated: listener, onUpdated: listener, onRemoved: listener,
      onMoved: listener, onAttached: listener, onDetached: listener
    };
    this.windows = {
      getAll: async () => [...this.winRecords.values()].map((w) => ({ ...w, id: w.id, tabs: undefined })),
      create: async ({ url, focused }) => {
        const w = this._addWindow({});
        for (const u of [].concat(url ?? [])) {
          const t = this._makeTab(w.id, u, { index: w.tabs.length });
          w.tabs.push(t.id);
        }
        return { ...w, tabs: undefined };
      },
      get: async (id) => {
        const w = this.winRecords.get(id);
        if (!w) throw new Error('No window with that id');
        return {
          ...w,
          tabs: w.tabs.map((tid) => ({ ...this.tabRecords.get(tid) }))
        };
      },
      getLastFocused: async () => [...this.winRecords.values()].at(-1) ?? this._addWindow({}),
      update: async (id, props) => { Object.assign(this.winRecords.get(id), props); },
      onCreated: listener, onRemoved: listener
    };
    this.tabGroups = {
      query: async () => [...this.groups.values()],
      update: async (id, props) => { Object.assign(this.groups.get(id), props); return this.groups.get(id); },
      onUpdated: listener, onRemoved: listener
    };
  }

  _makeTab(windowId, url, { index = 0, active = false, pinned = false, title = '', lastAccessed = Date.now() } = {}) {
    const id = nextTabId++;
    const t = {
      id, windowId, index, url, title: title || url,
      pinned, active, audible: false, discarded: false,
      groupId: -1, lastAccessed, favIconUrl: ''
    };
    this.tabRecords.set(id, t);
    return { ...t };
  }

  _addWindow({ incognito = false } = {}) {
    const id = nextWinId++;
    this.winRecords.set(id, { id, type: 'normal', state: 'normal', incognito, focused: false, left: 0, top: 0, width: 1000, height: 800, tabs: [] });
    return this.winRecords.get(id);
  }

  /** Seed tabs: array of {url, title, pinned, groupIdTitle, windowIndex, lastAccessed, active} */
  seed({ windows = [[]], groups = {} } = {}) {
    const groupIdsByTitle = {};
    for (const [title, color] of Object.entries(groups)) {
      const gid = nextGroupId++;
      this.groups.set(gid, { id: gid, title, color, windowId: this.winRecords.keys().next().value });
      groupIdsByTitle[title] = gid;
    }
    const winIds = [];
    for (const spec of windows) {
      const w = this._addWindow({});
      winIds.push(w.id);
      spec.forEach((s, i) => {
        const t = this._makeTab(w.id, s.url ?? 'https://example.com/', {
          index: i,
          active: !!s.active,
          pinned: !!s.pinned,
          title: s.title ?? '',
          lastAccessed: s.lastAccessed ?? Date.now()
        });
        if (s.groupTitle && groupIdsByTitle[s.groupTitle] != null) {
          const rec = this.tabRecords.get(t.id);
          rec.groupId = groupIdsByTitle[s.groupTitle];
        }
        w.tabs.push(t.id);
      });
    }
    return winIds;
  }

  _queryTabs(q = {}) {
    let out = [...this.tabRecords.values()];
    if (q.windowIds) out = out.filter((t) => q.windowIds.includes(t.windowId));
    return out.map((t) => ({ ...t }));
  }

  /** Recompute every tab's index from its window's tab order (Chrome semantics). */
  _reindex() {
    for (const w of this.winRecords.values()) {
      w.tabs.forEach((tid, i) => {
        const t = this.tabRecords.get(tid);
        if (t) t.index = i;
      });
    }
  }

  _ungroupRecord(id) {
    const t = this.tabRecords.get(id);
    if (!t) return;
    const old = t.groupId;
    t.groupId = -1;
    // Chrome destroys a group when its last member leaves.
    if (old != null && old !== -1) {
      const stillHasMembers = [...this.tabRecords.values()].some((x) => x.groupId === old);
      if (!stillHasMembers) this.groups.delete(old);
    }
  }

  _tabOrThrow(id) {
    const t = this.tabRecords.get(id);
    if (!t) throw new Error(`No tab with id: ${id}`);
    return { ...t };
  }

  /** Current layout: per window, the ordered tab ids with pin/group info. */
  layout() {
    return [...this.winRecords.values()].map((w) => ({
      id: w.id,
      tabs: w.tabs.map((tid) => {
        const t = this.tabRecords.get(tid);
        return { id: tid, pinned: t.pinned, groupId: t.groupId };
      })
    }));
  }

  liveGroupTitles() {
    return [...this.groups.values()].map((g) => g.title).filter(Boolean);
  }

  openUrls() {
    return new Set([...this.tabRecords.values()].map((t) => t.url));
  }
}

/** Reset id counters so tests are deterministic across runs. */
export function resetIds() {
  nextTabId = 1; nextWinId = 1; nextGroupId = 1;
}

/** Install the fake chrome into globalThis (mimics the real global). */
export function installFakeChrome(opts) {
  const fc = new FakeChrome(opts);
  globalThis.chrome = fc;
  return fc;
}

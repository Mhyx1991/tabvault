// Storage layer.
// - chrome.storage.local: settings + small metadata (fast, sync-friendly)
// - IndexedDB ('tabvault'): snapshots, workspaces (can be large), kv
// Everything is local to the device. No network calls anywhere in this file.

import { DEFAULT_SETTINGS } from '../shared/constants.js';
import { TvError, logError } from './errors.js';

const DB_NAME = 'tabvault';
const DB_VERSION = 1;
const STORES = { SNAPSHOTS: 'snapshots', WORKSPACES: 'workspaces', KV: 'kv' };

let _db = null;
let _openPromise = null;

export function isStorageAvailable() {
  return _db !== null;
}

export function openDB() {
  if (_db) return Promise.resolve(_db);
  if (_openPromise) return _openPromise;
  _openPromise = new Promise((resolve, reject) => {
    let req;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (e) {
      reject(new TvError('STORAGE_UNAVAILABLE', undefined, e));
      return;
    }
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
    req.onsuccess = () => {
      _db = req.result;
      _db.onclose = () => { _db = null; _openPromise = null; };
      resolve(_db);
    };
    req.onerror = () => reject(new TvError('STORAGE_UNAVAILABLE', undefined, req.error));
    req.onblocked = () => reject(new TvError('STORAGE_UNAVAILABLE', new Error('IndexedDB open blocked')));
  });
  try {
    return _openPromise;
  } catch (e) {
    logError('openDB', e);
    return Promise.reject(e);
  }
}

async function tx(storeName, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeName, mode);
    const store = t.objectStore(storeName);
    let request = null;
    t.oncomplete = () => resolve(request ? request.result : undefined);
    t.onerror = () => reject(new TvError('STORAGE_UNAVAILABLE', undefined, t.error));
    t.onabort = () => reject(new TvError('STORAGE_UNAVAILABLE', undefined, t.error));
    try {
      // fn may return an IDBRequest whose result we want, or just queue writes.
      request = fn(store) || null;
    } catch (e) {
      reject(new TvError('STORAGE_UNAVAILABLE', undefined, e));
    }
  });
}

export async function idbPut(storeName, value) {
  await tx(storeName, 'readwrite', (store) => { store.put(value); });
}

export async function idbBulkPut(storeName, values) {
  await tx(storeName, 'readwrite', (store) => {
    for (const v of values) store.put(v);
  });
}

export async function idbGet(storeName, key) {
  const v = await tx(storeName, 'readonly', (store) => store.get(key));
  return v ?? null;
}

export async function idbGetAll(storeName, indexName, direction = 'next') {
  const rows = await tx(storeName, 'readonly', (store) =>
    indexName ? store.index(indexName).getAll() : store.getAll()
  );
  const arr = rows || [];
  if (direction === 'prev') arr.sort((a, b) => (b.createdAt ?? b.updatedAt ?? 0) - (a.createdAt ?? a.updatedAt ?? 0));
  return arr;
}

export async function idbDelete(storeName, key) {
  await tx(storeName, 'readwrite', (store) => { store.delete(key); });
}

export async function idbBulkDelete(storeName, keys) {
  await tx(storeName, 'readwrite', (store) => {
    for (const k of keys) store.delete(k);
  });
}

export async function idbClear(storeName) {
  await tx(storeName, 'readwrite', (store) => { store.clear(); });
}

/* ---------------- settings (chrome.storage.local) ---------------- */

export async function getSettings() {
  try {
    const { settings } = await chrome.storage.local.get('settings');
    return { ...DEFAULT_SETTINGS, ...(settings || {}) };
  } catch (e) {
    logError('getSettings', e);
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(patch) {
  const current = await getSettings();
  const next = { ...current, ...patch };
  await chrome.storage.local.set({ settings: next });
  // Fire-and-forget cloud push when the user opted into settings sync.
  // Imported lazily so storage.js stays free of sync logic at module scope.
  if (next.syncEnabled) {
    import('./sync.js').then(({ pushIfEnabled }) => pushIfEnabled(next)).catch(() => {});
  }
  return next;
}

/* ---------------- meta (chrome.storage.local) ---------------- */

const DEFAULT_META = {
  installedAt: 0,
  lastSnapshotAt: 0,
  lastOrganize: null, // { snapshotId, at, tabsGrouped, groups }
  dismissedFingerprint: null
};

export async function getMeta() {
  try {
    const { meta } = await chrome.storage.local.get('meta');
    return { ...DEFAULT_META, ...(meta || {}) };
  } catch (e) {
    logError('getMeta', e);
    return { ...DEFAULT_META };
  }
}

export async function saveMeta(patch) {
  const current = await getMeta();
  const next = { ...current, ...patch };
  await chrome.storage.local.set({ meta: next });
  return next;
}

/** Ensure defaults exist; called on install. */
export async function initDefaults() {
  const meta = await getMeta();
  if (!meta.installedAt) await saveMeta({ installedAt: Date.now() });
  await getSettings();
}

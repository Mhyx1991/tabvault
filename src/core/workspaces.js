// Workspace system — save, manage and re-open collections of tabs.

import { isIgnorableUrl } from '../shared/constants.js';
import { uid, normalizeUrl } from '../shared/utils.js';
import { idbPut, idbGet, idbGetAll, idbDelete } from './storage.js';
import { groupTabsInWindow, applyGroupMeta } from './tabs.js';

const STORE = 'workspaces';

export async function listWorkspaces() {
  const rows = (await idbGetAll(STORE, 'updatedAt')) || [];
  return rows.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export async function getWorkspace(id) {
  return idbGet(STORE, id);
}

/**
 * Create a workspace from tab descriptors. Duplicate URLs are de-duplicated
 * (first copy wins); new-tab/blank pages are skipped.
 */
export async function createWorkspace(name, tabs, { source = 'manual', color = 'blue' } = {}) {
  const seen = new Set();
  const kept = [];
  let duplicatesRemoved = 0;
  for (const t of tabs || []) {
    const url = t.url || '';
    if (isIgnorableUrl(url)) continue;
    const key = normalizeUrl(url);
    if (seen.has(key)) { duplicatesRemoved++; continue; }
    seen.add(key);
    kept.push({ url, title: t.title || '', pinned: !!t.pinned });
  }
  const ws = {
    id: uid(),
    name: ((name || '').trim() || 'Untitled workspace').slice(0, 80),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    source,
    color,
    tabs: kept,
    duplicatesRemoved
  };
  await idbPut(STORE, ws);
  return ws;
}

export async function renameWorkspace(id, name) {
  const ws = await idbGet(STORE, id);
  if (!ws) return null;
  ws.name = (name || ws.name).slice(0, 80);
  ws.updatedAt = Date.now();
  await idbPut(STORE, ws);
  return ws;
}

export async function deleteWorkspace(id) {
  await idbDelete(STORE, id);
}

/**
 * Open a workspace.
 * @param {'window'|'current'|'group'} target
 */
export async function openWorkspace(ws, target, { windowId = null } = {}) {
  const urls = (ws.tabs || []).map((t) => t.url).filter(Boolean);
  if (!urls.length) return { opened: 0, target };

  if (target === 'window') {
    const win = await chrome.windows.create({ url: urls.slice(0, 500), focused: true });
    for (const part of chunkUrls(urls.slice(500))) {
      for (const url of part) {
        await chrome.tabs.create({ windowId: win.id, url, active: false }).catch(() => {});
      }
    }
    return { opened: urls.length, target, windowId: win.id };
  }

  let wid = windowId;
  if (!wid) {
    const last = await chrome.windows.getLastFocused();
    wid = last?.id ?? null;
  }
  if (!wid) return openWorkspace(ws, 'window');

  const created = [];
  for (const url of urls) {
    try {
      const t = await chrome.tabs.create({ windowId: wid, url, active: false });
      created.push(t.id);
    } catch { /* skip unreachable */ }
  }

  if (target === 'group' && created.length) {
    try {
      const gid = await groupTabsInWindow(created, wid);
      await applyGroupMeta(gid, { title: ws.name, color: ws.color || 'blue' });
    } catch { /* tabs are open, just not grouped */ }
  }
  return { opened: created.length, target, windowId: wid };
}

function chunkUrls(urls, size = 500) {
  const out = [];
  for (let i = 0; i < urls.length; i += size) out.push(urls.slice(i, i + size));
  return out;
}

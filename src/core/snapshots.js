// Snapshot / recovery system — the safety net behind every organizing action.
//
// Two restore modes:
//  - restoreLayout(snapshot): undo — moves LIVING tabs back to their snapshot
//    windows/positions/groups by tab id. Opens nothing, closes nothing.
//  - restoreSnapshot(snapshot): opens whatever is missing from the snapshot,
//    reusing already-open tabs by URL. Never closes anything unless the user
//    explicitly opts into closing tabs that are not part of the snapshot.

import { LIMITS, isIgnorableUrl } from '../shared/constants.js';
import { uid, normalizeUrl, chunk } from '../shared/utils.js';
import {
  openDB, idbPut, idbGet, idbGetAll, idbDelete, idbBulkDelete,
  getSettings, getMeta, saveMeta
} from './storage.js';
import {
  getAllTabs, getNormalWindows, groupTabsInWindow, applyGroupMeta,
  ungroupTabs, closeTabsSafe, updateTabsSafe
} from './tabs.js';
import { TvError, logError } from './errors.js';

const STORE = 'snapshots';

/** Capture the current browser state (windows + tabs) without saving. */
export async function captureState(trigger = 'manual') {
  const windows = await getNormalWindows();
  const allTabs = await getAllTabs();
  const groups = new Map();
  try {
    const gs = await chrome.tabGroups.query({});
    for (const g of gs) groups.set(g.id, g);
  } catch { /* grouping optional */ }

  const byWindow = new Map();
  for (const t of allTabs) {
    if (!byWindow.has(t.windowId)) byWindow.set(t.windowId, []);
    byWindow.get(t.windowId).push(t);
  }

  let truncated = false;
  const snapshotWindows = [];
  let total = 0;
  for (const w of windows) {
    if (w.incognito) continue; // incognito is never captured (privacy)
    const tabs = (byWindow.get(w.id) || []).sort((a, b) => a.index - b.index);
    const entries = [];
    for (const t of tabs) {
      if (total >= LIMITS.SNAPSHOT_MAX_TABS) { truncated = true; break; }
      const g = t.groupId && t.groupId !== -1 ? groups.get(t.groupId) : null;
      entries.push({
        tabId: t.id,
        url: t.url || '',
        title: t.title || '',
        pinned: !!t.pinned,
        index: t.index,
        groupId: g ? g.id : -1,
        groupTitle: g ? g.title : '',
        groupColor: g ? g.color : ''
      });
      total++;
    }
    snapshotWindows.push({
      id: w.id,
      type: w.type,
      state: w.state,
      left: w.left, top: w.top, width: w.width, height: w.height,
      focused: !!w.focused,
      tabs: entries
    });
  }

  return {
    id: uid(),
    createdAt: Date.now(),
    trigger,
    app: 'TabVault',
    version: 1,
    counts: { tabs: total, windows: snapshotWindows.length },
    truncated,
    windows: snapshotWindows
  };
}

/** Capture + persist + update meta + prune retention. */
export async function createSnapshot(trigger = 'manual') {
  const snapshot = await captureState(trigger);
  await idbPut(STORE, snapshot);
  await saveMeta({ lastSnapshotAt: Date.now() });
  const settings = await getSettings();
  try {
    await pruneSnapshots(settings.snapshotRetention);
  } catch (e) {
    logError('pruneSnapshots', e);
  }
  return snapshot;
}

export async function listSnapshots() {
  const rows = (await idbGetAll(STORE, 'createdAt')) || [];
  return rows.sort((a, b) => b.createdAt - a.createdAt);
}

export async function getSnapshot(id) {
  return idbGet(STORE, id);
}

export async function deleteSnapshot(id) {
  await idbDelete(STORE, id);
}

export async function pruneSnapshots(retention = 30) {
  const keep = Math.max(3, Number(retention) || 30);
  const all = await listSnapshots();
  const doomed = all.slice(keep).map((s) => s.id);
  if (doomed.length) await idbBulkDelete(STORE, doomed);
  return doomed.length;
}

/* --------------------------- restore: open missing --------------------------- */

function keepPriority(t) {
  return (t.active ? 2 : 0) + (t.pinned ? 1 : 0) + (t.lastAccessed || 0) / 1e13;
}

/**
 * Restore a snapshot by opening what's missing. Reuses already-open tabs by
 * normalized URL so nothing is duplicated. Closes nothing unless explicitly
 * asked (and then only with the user's explicit confirmation upstream).
 */
export async function restoreSnapshot(snapshot, { closeExtraneous = false } = {}) {
  const current = await getAllTabs();
  const reuse = new Map();
  for (const t of current.slice().sort((a, b) => keepPriority(b) - keepPriority(a))) {
    const key = normalizeUrl(t.url);
    if (key && !reuse.has(key)) reuse.set(key, t);
  }

  const used = new Set();
  let reused = 0;
  let opened = 0;
  let windowsCreated = 0;

  for (const w of snapshot.windows) {
    if (!w || !Array.isArray(w.tabs)) continue; // tolerate corrupted/imported entries
    const missing = [];
    for (const e of w.tabs) {
      if (!e || typeof e.url !== 'string' || !e.url) continue;
      if (isIgnorableUrl(e.url)) continue;
      const ex = reuse.get(normalizeUrl(e.url));
      if (ex && !used.has(ex.id)) { used.add(ex.id); reused++; continue; }
      missing.push(e);
    }
    const urls = missing.map((e) => e.url).filter(Boolean);
    if (!urls.length) continue;

    const firstChunk = urls.slice(0, 500);
    let win;
    try {
      win = await chrome.windows.create({ url: firstChunk, focused: false });
    } catch (e) {
      logError('restoreSnapshot.window', e);
      continue;
    }
    windowsCreated++;
    opened += firstChunk.length;
    const rest = chunk(urls.slice(500), 500);
    for (const part of rest) {
      for (const url of part) {
        try {
          await chrome.tabs.create({ windowId: win.id, url, active: false });
          opened++;
        } catch { /* skip unreachable url */ }
      }
    }

    /* LAZY LOAD (anti-lag): a big restore used to wake every tab at once —
     * 80 music/video tabs all started playing. Discard everything except the
     * first tab so tabs sit unloaded on the strip and load only on click.
     * Best-effort: chrome.tabs.discard is skipped on failure silently.      */
    try {
      const { tabs: liveTabs } = await chrome.windows.get(win.id, { populate: true });
      const skipFirst = liveTabs.findIndex((t) => !t.pinned);
      for (let i = 0; i < liveTabs.length; i++) {
        if (i === skipFirst) continue;              // one tab loads as landing page
        if (liveTabs[i].pinned) continue;           // pinned are tiny anyway
        await chrome.tabs.discard(liveTabs[i].id).catch(() => {});
      }
    } catch { /* lazy load is best-effort */ }

    // Restore pinned state and group structure inside the new window.
    try {
      const { tabs: newTabs } = await chrome.windows.get(win.id, { populate: true });
      const openedEntries = missing.filter((e) => !isIgnorableUrl(e.url));
      const groupIntents = new Map(); // title → {title, color, tabIds}
      for (let i = 0; i < newTabs.length && i < openedEntries.length; i++) {
        const e = openedEntries[i];
        const t = newTabs[i];
        if (e.pinned) await chrome.tabs.update(t.id, { pinned: true }).catch(() => {});
        if (e.groupTitle) {
          const key = e.groupTitle;
          if (!groupIntents.has(key)) groupIntents.set(key, { title: e.groupTitle, color: e.groupColor || 'grey', tabIds: [] });
          groupIntents.get(key).tabIds.push(t.id);
        }
      }
      for (const intent of groupIntents.values()) {
        try {
          const gid = await chrome.tabs.group({ tabIds: intent.tabIds, createProperties: { windowId: win.id } });
          await applyGroupMeta(gid, { title: intent.title, color: intent.color });
        } catch { /* grouping is best-effort on restore */ }
      }
    } catch (e) {
      logError('restoreSnapshot.structure', e);
    }
  }

  let closed = 0;
  if (closeExtraneous) {
    const extraneous = current.filter((t) => !used.has(t.id)).map((t) => t.id);
    const res = await closeTabsSafe(extraneous);
    closed = res.closed;
  }

  return { opened, windowsCreated, reused, closed };
}

/* --------------------------- restore: layout undo --------------------------- */

/**
 * Undo-style restore: put living tabs (matched by tab id) back into the exact
 * windows, order, pinned state and groups they had in the snapshot.
 * Never opens or closes tabs. Tabs created after the snapshot are untouched.
 */
export async function restoreLayout(snapshot) {
  const current = await getAllTabs();
  const byId = new Map(current.map((t) => [t.id, t]));
  const wins = await getNormalWindows();
  const liveWinIds = new Set(wins.map((w) => w.id));

  const snapshotWinIds = snapshot.windows.map((w) => w.id).filter((id) => liveWinIds.has(id));
  let fallbackWin = snapshotWinIds[0] ?? wins.find((w) => !w.incognito)?.id ?? null;
  if (!fallbackWin) {
    try {
      const w = await chrome.windows.create({ url: 'about:blank', focused: false });
      fallbackWin = w.id;
      liveWinIds.add(w.id);
    } catch (e) {
      throw new TvError('NO_UNDO', undefined, e);
    }
  }

  const liveEntries = [];
  let missing = 0;
  const inSnapshot = new Set();
  for (const w of snapshot.windows) {
    for (const e of w.tabs) {
      inSnapshot.add(e.tabId);
      const t = byId.get(e.tabId);
      if (t) liveEntries.push({ e, t });
      else missing++;
    }
  }
  const newTabs = current.length - liveEntries.length;

  // 1) Un-group snapshot tabs that are currently grouped (undo the organizing).
  const groupedIds = liveEntries.filter((x) => x.t.groupId && x.t.groupId !== -1).map((x) => x.t.id);
  if (groupedIds.length) await ungroupTabs(groupedIds);

  // 2) Move each tab back to its snapshot window/position, restore pinned.
  let moved = 0;
  const groupIntents = new Map(); // `${targetWinId}|${title}` → intent
  for (const w of snapshot.windows) {
    const target = liveWinIds.has(w.id) ? w.id : fallbackWin;
    const items = w.tabs.map((e) => ({ e, t: byId.get(e.tabId) })).filter((x) => x.t);
    const pinned = items.filter((x) => x.e.pinned);
    const unpinned = items.filter((x) => !x.e.pinned);
    let idx = 0;
    for (const x of [...pinned, ...unpinned]) {
      const t = x.t;
      // Always issue the move: `t` carries the index/window captured BEFORE we
      // started restoring, and earlier iterations may have shifted positions.
      // Moving a tab to the position it already occupies is a safe no-op.
      try {
        await chrome.tabs.move(t.id, { windowId: target, index: idx });
        moved++;
      } catch {
        try { await chrome.tabs.move(t.id, { windowId: target, index: -1 }); moved++; } catch { /* leave it */ }
      }
      try {
        if (t.pinned !== x.e.pinned) await chrome.tabs.update(t.id, { pinned: x.e.pinned });
      } catch { /* cosmetic */ }
      if (x.e.groupTitle) {
        const key = `${target}|${x.e.groupTitle}`;
        if (!groupIntents.has(key)) {
          groupIntents.set(key, { windowId: target, title: x.e.groupTitle, color: x.e.groupColor || 'grey', tabIds: [] });
        }
        groupIntents.get(key).tabIds.push(t.id);
      }
      idx++;
    }
  }

  // 3) Recreate the snapshot's groups.
  let regrouped = 0;
  for (const intent of groupIntents.values()) {
    try {
      const gid = await chrome.tabs.group({ tabIds: intent.tabIds, createProperties: { windowId: intent.windowId } });
      await applyGroupMeta(gid, { title: intent.title, color: intent.color });
      regrouped++;
    } catch { /* best-effort */ }
  }

  return { moved, missing, newTabsUntouched: newTabs, regrouped };
}

// Organization engine — turns suggestions into Chrome tab groups, safely.
// Contract:
//   1. If auto-snapshots are on, a snapshot is ALWAYS taken before any change.
//      If the snapshot fails, the whole operation aborts (fail-safe).
//   2. Grouping never closes or opens tabs — it only moves and groups them.
//   3. Individual group failures are contained and reported, never silent.

import { CATEGORY_MAP, CHROME_GROUP_COLORS } from '../shared/constants.js';
import { getSettings, getMeta, saveMeta } from './storage.js';
import { createSnapshot } from './snapshots.js';
import { getAllTabs, groupTabsInWindow, applyGroupMeta, moveTabsSafe } from './tabs.js';
import { TvError, logError } from './errors.js';

/** Convert UI suggestions into an execution plan. */
export function buildGroupsFromSuggestions(suggestions) {
  return (suggestions || [])
    .filter((s) => s && Array.isArray(s.tabIds) && s.tabIds.length > 0)
    .map((s) => ({
      id: s.id,
      name: s.name || (s.categoryId && CATEGORY_MAP.get(s.categoryId)?.name) || 'Group',
      color: CHROME_GROUP_COLORS.includes(s.color) ? s.color : 'grey',
      tabIds: s.tabIds.slice()
    }));
}

/**
 * Execute an organize plan: create Chrome tab groups for each group entry.
 * @param {Array<{name:string,color:string,tabIds:number[]}>} groups
 * @param {{mergeWindows?: boolean}} opts
 */
export async function organizeFromGroups(groups, { mergeWindows = false } = {}) {
  if (!Array.isArray(groups) || groups.length === 0) {
    return { applied: [], failed: [], tabsGrouped: 0, snapshotId: null };
  }

  const settings = await getSettings();
  let snapshotId = null;
  if (settings.autoSnapshot) {
    const snap = await createSnapshot('pre-organize');
    snapshotId = snap.id;
  }

  const live = await getAllTabs();
  const liveById = new Map(live.map((t) => [t.id, t]));

  const applied = [];
  const failed = [];
  let tabsGrouped = 0;

  for (const g of groups) {
    const ids = (g.tabIds || []).filter((id) => liveById.has(id));
    if (!ids.length) continue;

    const byWindow = new Map();
    for (const id of ids) {
      const t = liveById.get(id);
      if (!byWindow.has(t.windowId)) byWindow.set(t.windowId, []);
      byWindow.get(t.windowId).push(id);
    }

    let targets;
    if (mergeWindows && byWindow.size > 1) {
      // Merge every tab of this category into the window holding the most of them.
      let primary = null, best = -1;
      for (const [wid, list] of byWindow) {
        if (list.length > best) { best = list.length; primary = wid; }
      }
      const others = [];
      for (const [wid, list] of byWindow) {
        if (wid !== primary) others.push(...list);
      }
      if (others.length) await moveTabsSafe(others, primary, -1);
      targets = [[primary, ids]];
    } else {
      targets = [...byWindow.entries()];
    }

    for (const [windowId, tabIds] of targets) {
      try {
        const gid = await groupTabsInWindow(tabIds, windowId);
        await applyGroupMeta(gid, { title: g.name, color: g.color });
        applied.push({ name: g.name, windowId, count: tabIds.length });
        tabsGrouped += tabIds.length;
      } catch (e) {
        logError(`organize group "${g.name}"`, e);
        failed.push({ name: g.name, windowId, error: String(e && e.message || e) });
      }
    }
  }

  await saveMeta({
    lastOrganize: { snapshotId, at: Date.now(), tabsGrouped, groups: applied.length }
  });

  return { applied, failed, tabsGrouped, snapshotId };
}

/** Undo the most recent organization using its pre-organize snapshot (one-shot). */
export async function undoLastOrganize() {
  const meta = await getMeta();
  const lo = meta.lastOrganize;
  if (!lo || !lo.snapshotId) throw new TvError('NO_UNDO');
  const { getSnapshot, restoreLayout } = await import('./snapshots.js');
  const snap = await getSnapshot(lo.snapshotId);
  if (!snap) throw new TvError('NO_UNDO');
  const result = await restoreLayout(snap);
  // Undo is one-shot: consume the pointer so a second press reports NO_UNDO
  // instead of re-applying a stale layout over the user's newer changes.
  await saveMeta({ lastOrganize: null });
  return result;
}

// Auto-grouping — files tabs into Chrome groups as they open.
// Pure decision logic lives here (unit-testable); the side effect of calling
// chrome.tabs APIs lives in attachAutoGroupWatcher() and is only installed
// when the user enables the feature in Settings.
//
// Contract:
//  - NEVER moves a tab the user explicitly grouped (groupId !== -1 on open)
//  - NEVER touches pinned tabs, the new tab page, or TabVault's own pages
//  - Groups by the SAME engine as manual organize (user rules > domain map >
//    keywords), so "auto" and "Organize My Tabs" agree with each other
//  - Group naming/colors reuse Chrome group semantics (title + color)

import { CATEGORY_MAP, CHROME_GROUP_COLORS } from '../shared/constants.js';
import { hostOf, isHttpUrl } from '../shared/utils.js';
import { scoreTab } from './categorize.js';

/**
 * Decide what should happen to a freshly opened/updated tab. PURE.
 * @param {{id:number, url:string, title:string, groupId:number, pinned:boolean,
 *          windowId:number, lastAccessed?:number}} tab  chrome.tabs.Tab-like
 * @param {{autoGroup:boolean, domainRules?:object, minGroupSize?:number,
 *          minConfidence?:string}} settings
 * @param {Map<number,{title:string,color:string}>} groupsMap  existing groups in this window
 * @returns {null | {categoryId:string, name:string, color:string, confidence:string}}
 *   null → leave the tab alone
 */
export function autoGroupDecision(tab, settings, groupsMap = new Map()) {
  if (!settings?.autoGroup) return null;
  if (!tab || tab.pinned) return null;
  if (tab.groupId != null && tab.groupId !== -1) return null;   // user-managed already
  if (!isHttpUrl(tab.url || '')) return null;                   // newtab, chrome://, file:// etc.

  const { categoryId, confidence } = scoreTab(tab, { userRules: settings.domainRules || {} });
  if (!categoryId) return null;

  const minRank = { unsorted: 0, low: 1, medium: 2, high: 3 };
  const need = minRank[settings.minConfidence || 'medium'] ?? 2;
  if (minRank[confidence] < need) return null;

  const cat = CATEGORY_MAP.get(categoryId);
  if (!cat) return null;
  return {
    categoryId,
    name: cat.name,
    color: CHROME_GROUP_COLORS.includes(cat.color) ? cat.color : 'grey',
    confidence
  };
}

/**
 * Find an existing group in the window whose title matches `name` (our groups
 * are titled with the category name). Returns groupId or null. PURE.
 */
export function findGroupByName(groupsMap, name) {
  for (const g of groupsMap.values()) {
    if ((g.title || '') === name) return g.id;
  }
  return null;
}

/**
 * Install chrome.tabs listeners that group matching tabs as they open.
 * Called from the service worker on startup/install; internally checks the
 * setting on every event, so toggling the Settings switch takes effect
 * immediately without re-installing.
 */
export function attachAutoGroupWatcher(deps) {
  const { getSettings, groupTabsInWindow, applyGroupMeta, tabGroupMap, logError } = deps;
  // Debounce per window: several tabs can open in a burst (restore, link open).
  const pending = new Map(); // windowId → {tabIds, timer}
  const FLUSH_MS = 350;

  async function flush(windowId) {
    const entry = pending.get(windowId);
    if (!entry) return;
    pending.delete(windowId);
    const { tabIds } = entry;
    let failures = 0;
    try {
      const settings = await getSettings();
      if (!settings.autoGroup) return;
      const live = await Promise.all(
        tabIds.map(async (id) => {
          try { return await chrome.tabs.get(id); } catch { return null; }
        })
      );
      const valid = live.filter((t) => t && !t.pinned && (t.groupId == null || t.groupId === -1));
      if (!valid.length) return;

      const groupsMap = await tabGroupMap();
      // Bucket by decision; only group categories with >= minGroupSize total
      // tabs (existing members of a same-titled group count toward the size).
      const byCat = new Map();
      for (const t of valid) {
        const d = autoGroupDecision(t, settings, groupsMap);
        if (d) {
          if (!byCat.has(d.categoryId)) byCat.set(d.categoryId, []);
          byCat.get(d.categoryId).push({ tab: t, decision: d });
        }
      }
      for (const [catId, items] of byCat) {
        const name = items[0].decision.name;
        const color = items[0].decision.color;
        const min = Math.max(1, settings.minGroupSize ?? 2);
        const existing = findGroupByName(groupsMap, name);
        // If there is no existing group, only create one when we have enough tabs.
        if (!existing && items.length < min) continue;

        const ids = items.map((x) => x.tab.id);
        try {
          const first = items[0].tab;
          if (existing) {
            // Add to the existing group when it lives in the same window.
            const g = groupsMap.get(existing);
            if (g && g.windowId === first.windowId) {
              try {
                await chrome.tabs.group({ tabIds: ids, groupId: existing });
                continue;
              } catch { /* fall through: create a local group instead */ }
            }
          }
          const gid = await groupTabsInWindow(ids, first.windowId);
          await applyGroupMeta(gid, { title: name, color });
        } catch (e) {
          failures++;
          logError('autogroup apply', e);
        }
      }
      if (failures > 0) {
        // Surface repeated failures instead of failing silently (BUG-002).
        try {
          await chrome.action.setBadgeText({ text: '!' });
          await chrome.action.setBadgeBackgroundColor({ color: '#d92d20' });
          await chrome.action.setTitle({ title: `TabVault — auto-grouping failed ${failures} time${failures === 1 ? '' : 's'} recently (check the dashboard's Suggestions view).` });
        } catch { /* badge is cosmetic */ }
      }
    } catch (e) {
      logError('autogroup flush', e);
    }
  }

  function queue(tabId, windowId) {
    if (windowId == null) return;
    let entry = pending.get(windowId);
    if (!entry) { entry = { tabIds: [], timer: null }; pending.set(windowId, entry); }
    if (!entry.tabIds.includes(tabId)) entry.tabIds.push(tabId);
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => flush(windowId), FLUSH_MS);
  }

  chrome.tabs.onCreated.addListener((tab) => queue(tab.id, tab.windowId));
  // Tabs "become classifiable" after navigation starts and URL/title resolve.
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.url || changeInfo.title) queue(tabId, tab.windowId);
  });
}

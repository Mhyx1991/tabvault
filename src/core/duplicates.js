// Duplicate / near-duplicate tab detection (pure logic).

import { normalizeUrl, hostOf, isHttpUrl } from '../shared/utils.js';
import { isIgnorableUrl } from '../shared/constants.js';

/**
 * Group tabs by normalized URL.
 * @returns {Array<{key:string, host:string, tabs:Array}>} groups with >1 tab, largest first
 */
export function findDuplicateGroups(tabs) {
  const map = new Map();
  for (const t of tabs) {
    if (!isHttpUrl(t.url) || isIgnorableUrl(t.url)) continue;
    const key = normalizeUrl(t.url);
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(t);
  }
  const groups = [];
  for (const [key, group] of map) {
    if (group.length > 1) {
      groups.push({ key, host: hostOf(key), tabs: group.slice().sort(byKeepPriority) });
    }
  }
  groups.sort((a, b) => b.tabs.length - a.tabs.length || a.host.localeCompare(b.host));
  return groups;
}

/** Which copy to keep: active > pinned > most recently accessed > first. */
function byKeepPriority(a, b) {
  return (
    (b.active ? 1 : 0) - (a.active ? 1 : 0) ||
    (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) ||
    (b.lastAccessed || 0) - (a.lastAccessed || 0) ||
    (a.index ?? 0) - (b.index ?? 0)
  );
}

/**
 * For one duplicate group, pick the keeper and the tabs to close.
 */
export function closePlan(group, { keepId = null } = {}) {
  const tabs = group.tabs.slice().sort(byKeepPriority);
  const keep = keepId != null ? tabs.find((t) => t.id === keepId) || tabs[0] : tabs[0];
  const close = tabs.filter((t) => t.id !== keep.id).map((t) => t.id);
  return { keep, close };
}

export function countDuplicateTabs(groups) {
  return groups.reduce((n, g) => n + g.tabs.length - 1, 0);
}

/**
 * Cluster tabs that share a site but are DIFFERENT pages (e.g. four
 * lalala.com/watch/<id> tabs). Pure.
 *
 * Deliberately conservative:
 *  - needs >= minTabs tabs from the same hostname (default 3) — noise guard
 *  - clusters are only reported when they add information beyond exact
 *    duplicates: a cluster whose host already has an exact-duplicate group is
 *    still reported (different signal), but single strays never create one
 *  - never merges different hosts (www. is stripped first)
 *
 * @returns {Array<{host:string, tabs:Array, count:number}>} largest first
 */
export function findSameSiteClusters(tabs, { minTabs = 3 } = {}) {
  const map = new Map();
  for (const t of tabs) {
    if (!isHttpUrl(t.url) || isIgnorableUrl(t.url)) continue;
    const host = hostOf(t.url);
    if (!host) continue;
    if (!map.has(host)) map.set(host, []);
    map.get(host).push(t);
  }
  const clusters = [];
  for (const [host, group] of map) {
    if (group.length >= minTabs) {
      clusters.push({
        host,
        count: group.length,
        tabs: group.slice().sort(byKeepPriority)
      });
    }
  }
  clusters.sort((a, b) => b.count - a.count || a.host.localeCompare(b.host));
  return clusters;
}

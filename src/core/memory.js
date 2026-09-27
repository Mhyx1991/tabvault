// Memory + tab-hygiene engine: discarding, stashing, tab caps.
//
// LAG CONTRACT (why this file is structured the way it is):
//  - ZERO polling loops and ZERO setInterval anywhere. All work is
//    event-driven: chrome.tabs events, chrome.alarms (max 1/hour), or an
//    explicit user click.
//  - Discarding touches at most DISCARD_BATCH tabs per alarm pass and always
//    skips: active tab, pinned tabs, audible tabs, whitelisted hosts, any tab
//    modified within the idle window, and unresolvable URLs.
//  - All selection logic below is PURE (unit-testable, no chrome.* calls).

import { isIgnorableUrl } from '../shared/constants.js';
import { hostOf } from '../shared/utils.js';

const DISCARD_BATCH = 20; // max tabs unloaded per pass — keeps CPU flat

/**
 * Pick tabs safe to discard. PURE.
 * Safety rules (a tab is skipped if ANY apply):
 *  - active in its window, or pinned, or playing audio
 *  - URL missing / not http(s) / ignorable (newtab etc.)
 *  - hostname matches the user's whitelist (exact or subdomain)
 *  - lastAccessed newer than the idle window (Chrome may omit
 *    lastAccessed on some platforms; then we conservatively SKIP)
 * @param {Array} tabs chrome tabs (needs id, url, active, pinned, audible, lastAccessed, windowId)
 * @param {{discardAfterMinutes:number, discardWhitelist:string[]}} settings
 * @param {number} now current timestamp (injectable for tests)
 * @returns {Array} candidate tabs, oldest first, capped at DISCARD_BATCH
 */
export function selectDiscardCandidates(tabs, settings, now = Date.now()) {
  const minutes = Number(settings?.discardAfterMinutes) || 0;
  if (minutes <= 0) return []; // explicit off
  const idleMs = Math.max(5, minutes) * 60_000;
  const whitelist = (settings?.discardWhitelist || []).map((h) => String(h).toLowerCase());
  const isWhitelisted = (host) => whitelist.some((w) => host === w || host.endsWith('.' + w));

  const candidates = (tabs || []).filter((t) => {
    if (!t || t.id == null) return false;
    if (t.active) return false;
    if (t.pinned) return false;
    if (t.audible) return false;
    if (!t.url || !/^https?:\/\//i.test(t.url)) return false;
    if (isIgnorableUrl(t.url)) return false;
    const host = hostOf(t.url);
    if (!host || isWhitelisted(host)) return false;
    // Conservative: no reliable timestamp → don't touch it.
    if (!t.lastAccessed || typeof t.lastAccessed !== 'number') return false;
    return now - t.lastAccessed >= idleMs;
  });

  candidates.sort((a, b) => (a.lastAccessed || 0) - (b.lastAccessed || 0)); // oldest first
  return candidates.slice(0, DISCARD_BATCH);
}

/**
 * Evaluate tab caps for every window. PURE.
 * @param {Array} tabs all tabs (need windowId)
 * @param {{tabCap:number}} settings
 * @returns {Array<{windowId:number, count:number, cap:number, over:number}>}
 *   windows that are AT or OVER their cap (over = how many tabs above cap-1 warn threshold)
 */
export function windowsOverCap(tabs, settings) {
  const cap = Math.max(0, Number(settings?.tabCap) || 0);
  if (!cap) return [];
  const perWindow = new Map();
  for (const t of tabs || []) {
    if (!t || t.windowId == null) continue;
    perWindow.set(t.windowId, (perWindow.get(t.windowId) || 0) + 1);
  }
  const out = [];
  for (const [windowId, count] of perWindow) {
    if (count >= cap) out.push({ windowId, count, cap, over: count - cap });
  }
  return out;
}

/**
 * Build a stash plan from all tabs. PURE.
 * Groups tabs by window; keeps pinned tabs OUT of the stash (they're meant
 * to stay); captures URL + title so restore can recreate everything.
 * @param {Array} tabs
 * @returns {{groups: Array<{windowId:number, entries:Array<{url:string,title:string}>}>, stashed:number, keptPinned:number}}
 */
export function buildStashPlan(tabs) {
  const groups = new Map();
  let stashed = 0;
  let keptPinned = 0;
  for (const t of tabs || []) {
    if (!t || !t.url || isIgnorableUrl(t.url)) continue;
    if (!/^https?:\/\//i.test(t.url)) continue; // don't stash chrome:// pages
    if (t.pinned) { keptPinned++; continue; }
    if (!groups.has(t.windowId)) groups.set(t.windowId, []);
    groups.get(t.windowId).push({ url: t.url, title: t.title || '' });
    stashed++;
  }
  return {
    groups: [...groups.entries()].map(([windowId, entries]) => ({ windowId, entries })),
    stashed,
    keptPinned
  };
}

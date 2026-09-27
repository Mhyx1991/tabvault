// Stale tab detection (pure logic).
// Uses chrome.tabs.Tab.lastAccessed (Chrome 121+, our minimum version).

import { isIgnorableUrl } from '../shared/constants.js';
import { isHttpUrl } from '../shared/utils.js';

/**
 * @param {Array} tabs
 * @param {{days?: number}} opts
 * @returns {{stale: Array, capabilityMissing: boolean, checked: number}}
 */
export function findStaleTabs(tabs, { days = 7 } = {}) {
  const cutoff = Date.now() - days * 86_400_000;
  const stale = [];
  let capabilityMissing = false;
  let checked = 0;
  for (const t of tabs) {
    if (t.pinned) continue;               // pinned = intentionally kept
    if (t.active) continue;               // currently viewed
    if (t.audible) continue;              // playing media
    if (isIgnorableUrl(t.url)) continue;
    if (!isHttpUrl(t.url) && !String(t.url || '').startsWith('chrome://')) continue;
    checked++;
    if (typeof t.lastAccessed !== 'number') {
      capabilityMissing = true;
      continue;
    }
    if (t.lastAccessed <= cutoff) stale.push(t);
  }
  stale.sort((a, b) => (a.lastAccessed || 0) - (b.lastAccessed || 0)); // oldest first
  return { stale, capabilityMissing, checked };
}

// Fast, fully-local search across open tabs and workspaces (pure logic).

import { hostOf } from '../shared/utils.js';
import { isIgnorableUrl, LIMITS } from '../shared/constants.js';

const WEIGHTS = { title: 3, host: 2.5, url: 1, group: 2 };

function scoreField(text, token, weight, startsWithBonus) {
  if (!text) return 0;
  const idx = text.indexOf(token);
  if (idx === -1) return 0;
  let s = weight;
  if (idx === 0) s += startsWithBonus;
  return s;
}

/**
 * Search open tabs. All query tokens must match somewhere (AND).
 * @param {string} query
 * @param {Array} tabs
 * @param {Map<number,{title:string}>} groupsMap groupId → group info
 */
export function searchTabs(query, tabs, groupsMap = new Map()) {
  const q = (query || '').trim().toLowerCase();
  if (!q) {
    // Empty query → most recently accessed tabs (recents).
    return tabs
      .filter((t) => !isIgnorableUrl(t.url))
      .slice()
      .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))
      .slice(0, 8)
      .map((tab) => ({ tab, score: 0 }));
  }
  const tokens = q.split(/\s+/).filter(Boolean);
  const results = [];
  for (const tab of tabs) {
    if (isIgnorableUrl(tab.url)) continue;
    const title = (tab.title || '').toLowerCase();
    const url = (tab.url || '').toLowerCase();
    const host = hostOf(tab.url);
    const group = tab.groupId && tab.groupId !== -1 ? (groupsMap.get(tab.groupId)?.title || '') : '';
    let score = 0;
    let allMatch = true;
    for (const token of tokens) {
      const s =
        scoreField(title, token, WEIGHTS.title, 2) +
        scoreField(host, token, WEIGHTS.host, 1.5) +
        scoreField(url, token, WEIGHTS.url, 0) +
        scoreField(group.toLowerCase(), token, WEIGHTS.group, 1);
      if (s === 0) { allMatch = false; break; }
      score += s;
    }
    if (allMatch && score > 0) results.push({ tab, score });
  }
  results.sort((a, b) => b.score - a.score || (b.tab.lastAccessed || 0) - (a.tab.lastAccessed || 0));
  return results.slice(0, LIMITS.SEARCH_RESULTS);
}

/**
 * Search workspaces by name and contained tab titles/URLs.
 */
export function searchWorkspaces(query, workspaces) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return [];
  const tokens = q.split(/\s+/).filter(Boolean);
  const results = [];
  for (const ws of workspaces) {
    const name = (ws.name || '').toLowerCase();
    let score = 0;
    let allMatch = true;
    for (const token of tokens) {
      let s = scoreField(name, token, 5, 2);
      if (s === 0) {
        for (const t of ws.tabs || []) {
          s = Math.max(
            s,
            scoreField((t.title || '').toLowerCase(), token, 1.5, 0) +
              scoreField((t.url || '').toLowerCase(), token, 1, 0)
          );
          if (s > 0) break;
        }
      }
      if (s === 0) { allMatch = false; break; }
      score += s;
    }
    if (allMatch && score > 0) results.push({ workspace: ws, score });
  }
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, 10);
}

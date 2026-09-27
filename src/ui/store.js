// Central UI state + actions. Both the dashboard and the popup import this.

import { analyzeTabs } from '../core/categorize.js';
import { organizeFromGroups, buildGroupsFromSuggestions } from '../core/organize.js';
import { createSnapshot, listSnapshots } from '../core/snapshots.js';
import { listWorkspaces } from '../core/workspaces.js';
import { findDuplicateGroups, countDuplicateTabs, findSameSiteClusters } from '../core/duplicates.js';
import { findStaleTabs } from '../core/stale.js';
import { getAllTabs, getNormalWindows, tabGroupMap, tabDescriptor } from '../core/tabs.js';
import { getSettings, saveSettings, getMeta, saveMeta, isStorageAvailable } from '../core/storage.js';
import { djb2, normalizeUrl, relativeTime } from '../shared/utils.js';
import { TvError, friendly, logError } from '../core/errors.js';

export const store = {
  loaded: false,
  settings: null,
  meta: null,
  tabs: [],            // tab descriptors
  rawTabs: [],         // raw chrome tabs (for analysis)
  windowsCount: 0,
  groups: new Map(),   // groupId → chrome tab group
  analysis: null,      // {suggestions, unsorted, existingGroups, stats}
  analysisFp: null,
  workspaces: [],
  snapshots: [],
  duplicates: [],
  dupTabCount: 0,
  sameSiteClusters: [],
  stale: null
};

const listeners = new Set();
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
// Coalesced emit: burst writes (50 settings flips, tab events during page
// load) used to trigger one FULL dashboard re-render each — that was the lag.
// Now renders are coalesced to one per animation frame (fallback: 16ms timer
// under Node/tests), so a burst costs one render no matter how many events fired.
let emitQueued = false;
export function emit() {
  if (emitQueued) return;
  emitQueued = true;
  const schedule = typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame
    : (fn) => setTimeout(fn, 16);
  schedule(() => {
    emitQueued = false;
    for (const fn of listeners) fn();
  });
}

/* ------------------------------- loading ------------------------------- */

export async function loadCore() {
  store.settings = await getSettings();
  store.meta = await getMeta();
  await refreshTabs();
  try { store.workspaces = await listWorkspaces(); } catch (e) { logError('workspaces', e); }
  try { store.snapshots = await listSnapshots(); } catch (e) { logError('snapshots', e); }
  store.loaded = true;
  emit();
}

export async function refreshTabs() {
  try {
    const [tabs, wins, groups] = await Promise.all([getAllTabs(), getNormalWindows(), tabGroupMap()]);
    store.rawTabs = tabs;
    store.tabs = tabs.map(tabDescriptor);
    store.windowsCount = wins.length;
    store.groups = groups;
  } catch (e) {
    logError('refreshTabs', e);
  }
  store.duplicates = findDuplicateGroups(store.tabs);
  store.dupTabCount = countDuplicateTabs(store.duplicates);
  store.sameSiteClusters = findSameSiteClusters(store.tabs, { minTabs: 3 });
  store.stale = findStaleTabs(store.tabs, { days: store.settings?.staleDays ?? 7 });
}

export async function refreshData() {
  store.settings = await getSettings();
  store.meta = await getMeta();
  await refreshTabs();
  try { store.workspaces = await listWorkspaces(); } catch (e) { logError('workspaces', e); }
  try { store.snapshots = await listSnapshots(); } catch (e) { logError('snapshots', e); }
  emit();
}

export function fingerprint() {
  const urls = store.tabs.map((t) => normalizeUrl(t.url)).sort();
  return djb2(urls.join('|') + '#' + urls.length);
}

/* ------------------------------ analysis ------------------------------- */

export async function ensureAnalysis(force = false) {
  const fp = store.analysisFp ?? fingerprint();
  // When updateSettings nulled the analysis, analysisFp holds the bumped
  // timestamped fingerprint — rebuild unconditionally and keep it, so the
  // suggestions planCache also rebuilds (appearance changed, tabs didn't).
  if (!force && store.analysis && store.analysisFp === fp) return store.analysis;
  if (!store.settings?.autoSuggest) { store.analysis = null; store.analysisFp = fp; return null; }
  store.analysis = analyzeTabs(store.rawTabs, store.settings, store.groups);
  store.analysisFp = fp;
  return store.analysis;
}

export function dismissed() {
  return !!store.meta?.dismissedFingerprint && store.meta.dismissedFingerprint === store.analysisFp;
}

export async function dismissSuggestions() {
  store.meta = await saveMeta({ dismissedFingerprint: store.analysisFp });
  emit();
}

/* ------------------------------- actions ------------------------------- */

export async function applyGroups(groups, { mergeWindows = false } = {}) {
  const result = await organizeFromGroups(groups, { mergeWindows });
  store.meta = await getMeta();
  await refreshTabs();
  emit();
  return result;
}

export async function acceptSuggestions({ mergeWindows = false } = {}) {
  const analysis = await ensureAnalysis(true);
  if (!analysis || !analysis.suggestions.length) {
    return { applied: [], failed: [], tabsGrouped: 0, snapshotId: null, nothingToDo: true };
  }
  const groups = buildGroupsFromSuggestions(analysis.suggestions);
  const result = await organizeFromGroups(groups, { mergeWindows });
  store.meta = await getMeta();
  await refreshTabs();
  emit();
  return { ...result, nothingToDo: false };
}

export async function undoOrganize() {
  const { undoLastOrganize } = await import('../core/organize.js');
  const result = await undoLastOrganize();
  store.meta = await getMeta();
  await refreshTabs();
  emit();
  return result;
}

export async function createDomainRule(host, categoryId) {
  const rules = { ...(store.settings.domainRules || {}) };
  rules[host] = categoryId;
  store.settings = await saveSettings({ domainRules: rules });
  emit();
}

export async function removeDomainRule(host) {
  const rules = { ...(store.settings.domainRules || {}) };
  delete rules[host];
  store.settings = await saveSettings({ domainRules: rules });
  emit();
}

export async function updateSettings(patch) {
  store.settings = await saveSettings(patch);
  // Appearance-affecting changes (names/emojis/hidden categories/rules/
  // confidence) must invalidate the cached analysis, or suggestion cards
  // keep showing stale emojis/names until the tab set itself changes.
  const AFFECTS_ANALYSIS = [
    'categoryNames', 'categoryEmojis', 'hiddenCategories',
    'domainRules', 'minConfidence', 'minGroupSize', 'preserveExistingGroups', 'autoSuggest'
  ];
  if (AFFECTS_ANALYSIS.some((k) => k in patch)) {
    store.analysis = null;
    // New fingerprint value too — suggestions.js planCache is keyed on fp and
    // must rebuild even though the tab set itself didn't change.
    store.analysisFp = fingerprint() + '|' + Date.now();
  }
  emit();
  return store.settings;
}

export async function saveSnapshotNow() {
  const snap = await createSnapshot('manual');
  store.meta = await getMeta();
  store.snapshots = await listSnapshots();
  emit();
  return snap;
}

export async function refreshWorkspaces() {
  store.workspaces = await listWorkspaces();
  emit();
}

export async function refreshSnapshots() {
  store.snapshots = await listSnapshots();
  emit();
}

/* ------------------------------ protection ----------------------------- */

export function protectionStatus() {
  const on = !!store.settings?.autoSnapshot;
  const last = store.meta?.lastSnapshotAt || 0;
  return {
    on,
    label: on ? `Snapshots on · last ${relativeTime(last)}` : 'Snapshots off',
    className: on ? 'on' : 'off'
  };
}

export { TvError, friendly, logError, isStorageAvailable, buildGroupsFromSuggestions };

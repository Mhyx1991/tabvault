// TabVault background service worker.
// Responsibilities (kept deliberately small — UI pages do their own work):
//   - first-run defaults + baseline snapshot
//   - periodic auto-snapshots via chrome.alarms
//   - re-arm alarms on browser start

import { initDefaults, getSettings, getMeta, saveMeta } from '../core/storage.js';
import { createSnapshot } from '../core/snapshots.js';
import { logError } from '../core/errors.js';
import { attachAutoGroupWatcher } from '../core/autogroup.js';
import { bootPull } from '../core/sync.js';
import { groupTabsInWindow, applyGroupMeta, tabGroupMap } from '../core/tabs.js';
import { selectDiscardCandidates, windowsOverCap, buildStashPlan } from '../core/memory.js';

const ALARM = 'tabvault-snapshot';
const DISCARD_ALARM = 'tabvault-discard';
const DASHBOARD_URL = chrome.runtime.getURL('src/ui/dashboard.html');

chrome.runtime.onInstalled.addListener((details) => {
  handleInstall(details).catch((e) => logError('onInstalled', e));
});

chrome.runtime.onStartup.addListener(() => {
  periodicSnapshotCheck().catch((e) => logError('onStartup', e));
  setupAlarm().catch((e) => logError('setupAlarm', e));
  bootPull().catch((e) => logError('bootPull', e));
});

// Auto-group watcher: installed once; internally respects the autoGroup
// setting on every event, so toggling Settings takes effect immediately.
try {
  attachAutoGroupWatcher({ getSettings, groupTabsInWindow, applyGroupMeta, tabGroupMap, logError });
} catch (e) {
  logError('autogroup install', e);
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) {
    periodicSnapshotCheck().catch((e) => logError('alarm', e));
  }
  if (alarm.name === DISCARD_ALARM) {
    discardPass().catch((e) => logError('discardPass', e));
  }
});

/* ------------------------- memory saver (discard) -------------------------
 * LAG CONTRACT: runs at most once per hour via chrome.alarms (no polling),
 * discards at most 20 tabs per pass (pure selector in core/memory.js), and
 * always protects active/pinned/audible/whitelisted tabs. Discarding frees
 * the tab's process — the tab stays visible and reloads on click.          */
async function discardPass() {
  const settings = await getSettings();
  if (!settings.discardAfterMinutes) return { discarded: 0 };
  const tabs = await chrome.tabs.query({});
  const candidates = selectDiscardCandidates(tabs, settings);
  let discarded = 0;
  for (const t of candidates) {
    try { await chrome.tabs.discard(t.id); discarded++; } catch { /* window closing etc. */ }
  }
  return { discarded };
}

async function setupDiscardAlarm() {
  const settings = await getSettings();
  if (settings.discardAfterMinutes) {
    // Fixed hourly cadence regardless of idle window — each pass re-evaluates
    // from tab timestamps, so changing the threshold applies on the next pass.
    await chrome.alarms.create(DISCARD_ALARM, { periodInMinutes: 60, delayInMinutes: 5 });
  } else {
    await chrome.alarms.clear(DISCARD_ALARM);
  }
}

/* --------------------------- tab cap (badge nudge) ---------------------------
 * Event-driven only: evaluated when tabs are created/removed. Shows a '⚠ 5'
 * badge while any window is at/over the cap; clears when back under.        */
let capResetTimer = null;
async function updateCapBadge() {
  try {
    const settings = await getSettings();
    const tabs = settings.tabCap ? await chrome.tabs.query({}) : [];
    const over = windowsOverCap(tabs, settings);
    if (over.length) {
      const worst = over.reduce((a, b) => (b.over > a.over ? b : a));
      await chrome.action.setBadgeText({ text: '⚠' + (worst.over + 1) });
      await chrome.action.setBadgeBackgroundColor({ color: '#b45309' });
    } else {
      await chrome.action.setBadgeText({ text: '' });
    }
  } catch (e) {
    logError('capBadge', e);
  }
}

// Cap badge: debounced — tab bursts (opening 20 tabs, session restore) fired
// one query+badge write per tab before.
let capBadgeTimer = null;
function scheduleCapBadge() {
  clearTimeout(capBadgeTimer);
  capBadgeTimer = setTimeout(() => updateCapBadge().catch((e) => logError('capBadge', e)), 800);
}
chrome.tabs.onCreated.addListener(scheduleCapBadge);
chrome.tabs.onRemoved.addListener(scheduleCapBadge);

/* --------------------- tab-close flush (from popup ✕) ---------------------
 * The popup queues ✕-marked tabs and hands them over here when it closes —
 * because Chrome dismisses the popup the instant a tab is removed, the popup
 * itself can't reliably finish the job. The service worker survives popup
 * death, so the "land on a surviving neighbor" switch always happens.       */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Only accept messages from our own extension pages (BUG-004: sender check).
  if (sender.id && sender.id !== chrome.runtime.id) return undefined;
  if (msg && msg.type === 'flush-tab-closes' && Array.isArray(msg.ids)) {
    closeTabBatch(msg.ids)
      .then((closed) => sendResponse({ closed }))
      .catch((e) => { logError('flush-tab-closes', e); sendResponse({ closed: 0 }); });
    return true; // async response
  }
  if (msg && msg.type === 'stash-all') {
    stashAll()
      .then((res) => sendResponse(res))
      .catch((e) => { logError('stash-all', e); sendResponse({ stashed: 0, error: String(e && e.message || e) }); });
    return true;
  }
  // NOTE: side-panel opening is NOT handled here on purpose —
  // chrome.sidePanel.open() requires a user gesture, which a message
  // round-trip destroys. The popup calls sidePanel.open() directly.
  return undefined;
});

/* ------------------------------- stash all --------------------------------
 * The panic button: snapshot EVERYTHING (safety net), then close every
 * non-pinned http(s) tab and open one fresh tab. Fully undoable — the
 * snapshot lands in History with trigger 'pre-stash', and 'Undo stash'
 * restores via restoreSnapshot's reuse-by-URL logic. Runs in the worker so
 * popup dismissal mid-operation can't interrupt it.                        */
async function stashAll() {
  const snap = await createSnapshot('pre-stash');
  const tabs = await chrome.tabs.query({});
  const plan = buildStashPlan(tabs);
  const stashedUrls = new Set(plan.groups.flatMap((g) => g.entries.map((e) => e.url)));

  // Keep the active tab of each window alive so windows never collapse;
  // close every other stashed tab.
  const keepAlive = new Set(
    tabs.filter((t) => t.active && stashedUrls.has(t.url)).map((t) => t.id)
  );

  let closed = 0;
  for (const t of tabs) {
    if (t.pinned) continue;                    // pinned tabs never stash
    if (keepAlive.has(t.id)) continue;         // window anchors stay
    if (!stashedUrls.has(t.url)) continue;     // chrome:// etc. stay open
    try { await chrome.tabs.remove(t.id); closed++; } catch { /* already gone */ }
  }

  // Open one fresh tab in the last focused window.
  try {
    const w = await chrome.windows.getLastFocused();
    await chrome.tabs.create({ windowId: w?.id });
  } catch { /* window may have closed; Chrome handles it */ }

  await saveMeta({ lastStash: { snapshotId: snap.id, at: Date.now(), stashed: plan.stashed, closed } });
  return { stashed: plan.stashed, closed, snapshotId: snap.id };
}

async function closeTabBatch(ids) {
  const marked = new Set(ids);
  // Pre-activate a surviving neighbor for each window whose ACTIVE tab is
  // being closed, so the user lands on the next tab over — like Chrome's own
  // tab ✕ — instead of a random jump.
  try {
    const tabs = await chrome.tabs.query({});
    const byWin = new Map();
    for (const t of tabs) {
      if (!byWin.has(t.windowId)) byWin.set(t.windowId, []);
      byWin.get(t.windowId).push(t);
    }
    for (const list of byWin.values()) {
      list.sort((a, b) => a.index - b.index);
      const act = list.find((t) => t.active);
      if (!act || !marked.has(act.id)) continue;
      const idx = list.findIndex((t) => t.id === act.id);
      let target = null;
      for (let i = idx + 1; i < list.length && !target; i++) if (!marked.has(list[i].id)) target = list[i];
      for (let i = idx - 1; i >= 0 && !target; i--) if (!marked.has(list[i].id)) target = list[i];
      if (target) {
        try { await chrome.tabs.update(target.id, { active: true }); } catch { /* best effort */ }
      }
      // No survivor → the window closes with its last tab (Chrome default).
    }
  } catch { /* best effort — Chrome picks its own neighbor */ }

  let closed = 0;
  for (const id of ids) {
    try { await chrome.tabs.remove(id); closed++; } catch { /* already gone */ }
  }
  return closed;
}

async function handleInstall({ reason }) {
  try {
    await initDefaults();
  } catch (e) {
    logError('initDefaults', e);
  }
  // Baseline snapshot: from the very first minute, Undo has something to offer.
  try {
    await createSnapshot('install');
  } catch (e) {
    logError('baseline snapshot', e);
  }
  try {
    await setupAlarm();
  } catch (e) {
    logError('setupAlarm', e);
  }
  try {
    await setupDiscardAlarm();
  } catch (e) {
    logError('setupDiscardAlarm', e);
  }
  if (reason === 'install') {
    // Open the dashboard exactly once, for onboarding. Never on updates.
    try {
      await chrome.tabs.create({ url: DASHBOARD_URL });
    } catch (e) {
      logError('open onboarding', e);
    }
  }
}

async function setupAlarm() {
  const settings = await getSettings();
  const periodMin = Math.max(60, (settings.snapshotFrequencyHours || 24) * 60);
  return chrome.alarms.create(ALARM, { periodInMinutes: periodMin, delayInMinutes: periodMin });
}

async function periodicSnapshotCheck() {
  const settings = await getSettings();
  if (!settings.autoSnapshot) return;
  const meta = await getMeta();
  const freqMs = Math.max(1, settings.snapshotFrequencyHours || 24) * 3_600_000;
  const last = meta.lastSnapshotAt || 0;
  if (Date.now() - last < freqMs) return;
  try {
    await createSnapshot('auto');
  } catch (e) {
    logError('periodic snapshot', e);
  }
}

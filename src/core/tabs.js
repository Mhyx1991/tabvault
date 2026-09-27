// Chrome tab/window operations with error containment.
// Every destructive or browser-mutating call is wrapped so a single failure
// never aborts a whole batch or leaves the user without a report.

let _extensionOrigin = null;
function ownOrigin() {
  if (_extensionOrigin === null) {
    try { _extensionOrigin = new URL(chrome.runtime.getURL('/')).origin; } catch { _extensionOrigin = ''; }
  }
  return _extensionOrigin;
}

/** All tabs across normal + popup windows, minus TabVault's own pages. */
export async function getAllTabs() {
  const tabs = await chrome.tabs.query({});
  const origin = ownOrigin();
  return tabs.filter((t) => {
    if (t.id == null) return false;
    if (origin && String(t.url || '').startsWith(origin)) return false;
    return true;
  });
}

export async function getNormalWindows() {
  return chrome.windows.getAll({ windowTypes: ['normal', 'popup'] });
}

export async function tabGroupMap() {
  try {
    const groups = await chrome.tabGroups.query({});
    return new Map(groups.map((g) => [g.id, g]));
  } catch {
    return new Map();
  }
}

/** Group tabs in a window; falls back to per-tab grouping on failure. */
export async function groupTabsInWindow(tabIds, windowId) {
  try {
    return await chrome.tabs.group({ tabIds, createProperties: { windowId } });
  } catch {
    let gid = null;
    for (const id of tabIds) {
      try {
        gid = await chrome.tabs.group({ tabIds: [id], createProperties: { windowId } });
      } catch { /* leave this tab ungrouped */ }
    }
    return gid;
  }
}

export async function applyGroupMeta(groupId, { title, color }) {
  if (!groupId) return;
  const update = {};
  if (title) update.title = String(title).slice(0, 60);
  if (color) update.color = color;
  try {
    await chrome.tabGroups.update(groupId, update);
  } catch { /* cosmetic only */ }
}

export async function ungroupTabs(tabIds) {
  const ok = [];
  for (const id of tabIds) {
    try { await chrome.tabs.ungroup(id); ok.push(id); } catch { /* not grouped */ }
  }
  return ok;
}

/** Batch move with per-tab fallback. Returns number of moves that succeeded. */
export async function moveTabsSafe(tabIds, windowId, index = -1) {
  let moved = 0;
  try {
    await chrome.tabs.move(tabIds, { windowId, index });
    return tabIds.length;
  } catch {
    for (const id of tabIds) {
      try { await chrome.tabs.move(id, { windowId, index }); moved++; } catch { /* skip */ }
    }
    return moved;
  }
}

export async function updateTabsSafe(tabIds, props) {
  let done = 0;
  for (const id of tabIds) {
    try { await chrome.tabs.update(id, props); done++; } catch { /* skip */ }
  }
  return done;
}

/** Close tabs; returns {closed, failed}. Never throws. */
export async function closeTabsSafe(tabIds) {
  let closed = 0;
  const failed = [];
  for (const id of tabIds) {
    try { await chrome.tabs.remove(id); closed++; } catch { failed.push(id); }
  }
  return { closed, failed };
}

export async function activateTab(tabId) {
  try {
    const t = await chrome.tabs.get(tabId);
    await chrome.tabs.update(tabId, { active: true });
    if (t.windowId) await chrome.windows.update(t.windowId, { focused: true }).catch(() => {});
    return true;
  } catch {
    return false;
  }
}

/** Render-friendly tab descriptor used across the UI. */
export function tabDescriptor(t) {
  return {
    id: t.id,
    url: t.url || '',
    title: t.title || t.url || 'Untitled',
    host: hostOfSafe(t.url),
    pinned: !!t.pinned,
    active: !!t.active,
    audible: !!t.audible,
    discarded: !!t.discarded,
    groupId: t.groupId ?? -1,
    windowId: t.windowId,
    index: t.index,
    lastAccessed: t.lastAccessed || 0,
    favIconUrl: t.favIconUrl || ''
  };
}

function hostOfSafe(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

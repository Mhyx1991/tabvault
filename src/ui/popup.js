// TabVault popup — fast stats, instant search, one-click organize.

import {
  store, loadCore, refreshTabs, ensureAnalysis, protectionStatus, dismissed,
  applyGroups, undoOrganize, buildGroupsFromSuggestions
} from './store.js';
import {
  el, clear, icon, toast, faviconEl, badge, closeTabBtn, confirmDialog
} from './components.js';
import { searchTabs, searchWorkspaces } from '../core/search.js';
import { activateTab } from '../core/tabs.js';
import { openWorkspace } from '../core/workspaces.js';
import { confirmAndOrganize, reportOrganizeResult } from './flows.js';
import { friendly, logError } from '../core/errors.js';
import { GROUP_COLOR_HEX } from '../shared/constants.js';

const searchInput = document.getElementById('popup-search');
const resultsEl = document.getElementById('popup-results');
const panelEl = document.getElementById('popup-panel');
const actionsEl = document.getElementById('popup-actions');
const organizeBtn = document.getElementById('popup-organize');
const undoBtn = document.getElementById('popup-undo');

const searchIcon = document.querySelector('[data-icon="search"]');
if (searchIcon) searchIcon.innerHTML = icon('search', 15); // guard: missing element must not kill the popup

/* --------------------------------- boot --------------------------------- */

(async function boot() {
  try {
    await loadCore();
  } catch (e) {
    logError('popup boot', e);
  }
  applyTheme();
  renderStats();
  renderRecents();
  searchInput.focus();
})();

function applyTheme() {
  const t = store.settings?.theme || 'system';
  const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

function renderStats() {
  const stats = document.getElementById('popup-stats');
  clear(stats).append(
    el('span', {}, el('b', { text: String(store.tabs.length) }), ' tabs'),
    el('span', {}, el('b', { text: String(store.windowsCount) }), ' win'),
    ...(store.dupTabCount ? [el('button', {
      class: 'badge badge-warn dup-link', text: `${store.dupTabCount} dup`,
      title: 'Review duplicate tabs',
      onclick: () => openDashboard('care')
    })] : [])
  );

  const p = protectionStatus();
  const chip = document.getElementById('popup-protection');
  chip.className = `protect-chip ${p.className}`;
  clear(chip).appendChild(el('span', { class: 'dot' }));
  chip.appendChild(document.createTextNode(p.label));

  undoBtn.hidden = !store.meta?.lastOrganize;
}

function renderRecents() {
  clear(resultsEl);
  const hits = searchTabs('', store.tabs, store.groups);
  if (!hits.length) {
    resultsEl.appendChild(el('div', { class: 'popup-hint', text: "You're all clear. No tabs to organize." }));
    return;
  }
  for (const { tab } of hits) resultsEl.appendChild(resultRow(tab));
}

function resultRow(tab) {
  const g = tab.groupId !== -1 && store.groups.has(tab.groupId) ? store.groups.get(tab.groupId) : null;
  // div (not button) so the per-row ✕ can nest inside; keyboard access via tabindex.
  const row = el('div', { class: 'tab-row', role: 'option', tabindex: '0' },
    faviconEl(tab.url),
    el('span', { class: 'tab-main' },
      el('span', { class: 'tab-title', text: tab.title || tab.url }),
      el('span', { class: 'tab-subline' },
        el('span', { class: 'tab-host', text: tab.host }),
        g ? badge(g.title || 'Group', 'muted') : null
      )
    ),
    closeTabBtn(tab, { onClosed: onTabClosed })
  );
  const activate = async () => {
    window.close();
    await activateTab(tab.id);
  };
  row.addEventListener('click', activate);
  row.addEventListener('keydown', (e) => { if (e.key === 'Enter') activate(); });
  return row;
}

/* ------- pending closes (keeps the popup open through ✕ clicks) -------
 * Chrome dismisses an action popup the moment a tab is removed while it is
 * open. So ✕ doesn't remove the tab right away: it hides the row, updates
 * the stats, and queues the real chrome.tabs.remove for when the popup is
 * about to close (or the user presses "Close now"). Net effect: you can ✕
 * as many tabs as you like in one session without the popup vanishing.     */
const pendingClose = new Map(); // tabId → tab descriptor

function onTabClosed(tab) {
  if (pendingClose.has(tab.id)) return;
  pendingClose.set(tab.id, tab);
  store.tabs = store.tabs.filter((t) => t.id !== tab.id);
  store.rawTabs = store.rawTabs.filter((t) => t.id !== tab.id);
  renderStats();
  runSearch();
  renderCloseBar();
}

/** Actually remove the queued tabs. Hand-off to the service worker: Chrome
 * dismisses the popup the instant the first tab is removed, which kills any
 * in-popup logic mid-flight. The worker survives dismissal, so it performs
 * the "land on a surviving neighbor" switch and then closes the tabs. */
async function flushPendingCloses() {
  if (!pendingClose.size) return 0;
  const ids = [...pendingClose.keys()];
  pendingClose.clear();
  const bar = document.getElementById('popup-closebar');
  if (bar) bar.remove();
  try {
    const res = await chrome.runtime.sendMessage({ type: 'flush-tab-closes', ids });
    return res?.closed ?? 0;
  } catch {
    // Worker unreachable (e.g. SW restarting) — fall back to closing directly.
    let closed = 0;
    for (const id of ids) {
      try { await chrome.tabs.remove(id); closed++; } catch { /* already gone */ }
    }
    return closed;
  }
}

function renderCloseBar() {
  let bar = document.getElementById('popup-closebar');
  if (!pendingClose.size) { if (bar) bar.remove(); return; }
  if (!bar) {
    bar = el('div', { class: 'popup-closebar', id: 'popup-closebar' });
    actionsEl.parentNode.insertBefore(bar, actionsEl);
  }
  clear(bar).append(
    el('span', { class: 'closebar-count', text: `${pendingClose.size} tab${pendingClose.size === 1 ? '' : 's'} marked for closing` }),
    el('span', { class: 'btn-row' },
      el('button', {
        class: 'btn btn-ghost btn-sm', text: 'Undo all',
        onclick: () => {
          for (const tab of pendingClose.values()) {
            // Cheap optimistic re-add; full refresh would also be fine.
            store.tabs.push(tab); store.rawTabs.push(tab);
          }
          pendingClose.clear();
          renderStats();
          runSearch();
          renderCloseBar();
        }
      }),
      el('button', {
        class: 'btn btn-danger btn-sm', text: 'Close now',
        onclick: async () => { await flushPendingCloses(); window.close(); }
      })
    )
  );
}

// Flush queued closes at the last possible moments:
window.addEventListener('blur', () => { flushPendingCloses(); });       // clicked elsewhere
window.addEventListener('pagehide', () => { flushPendingCloses(); });   // popup unloading
for (const btn of document.querySelectorAll('.link-btn[data-nav]')) {
  // Navigating to a dashboard view closes the popup — flush queued closes first.
  btn.addEventListener('click', () => { flushPendingCloses(); });
}

/* -------------------------------- search -------------------------------- */

let debounceT = null;
searchInput.addEventListener('input', () => {
  clearTimeout(debounceT);
  debounceT = setTimeout(runSearch, 80);
});
searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const first = resultsEl.querySelector('.tab-row');
    if (first) first.click();
  }
  if (e.key === 'Escape') {
    if (searchInput.value) { searchInput.value = ''; runSearch(); }
    else window.close();
  }
});

function runSearch() {
  const q = searchInput.value.trim();
  clear(resultsEl);
  const tabHits = searchTabs(q, store.tabs, store.groups);
  if (q && !tabHits.length) {
    resultsEl.appendChild(el('div', { class: 'popup-hint', text: `No open tabs match “${q}”.` }));
    return;
  }
  const label = q ? `Open tabs (${tabHits.length})` : 'Recent tabs';
  resultsEl.appendChild(el('div', { class: 'search-label', text: label }));
  for (const { tab } of tabHits.slice(0, q ? 25 : 8)) resultsEl.appendChild(resultRow(tab));

  if (q) {
    const wsHits = searchWorkspaces(q, store.workspaces);
    if (wsHits.length) {
      resultsEl.appendChild(el('div', { class: 'search-label', text: 'Workspaces' }));
      for (const { workspace: ws } of wsHits.slice(0, 4)) {
        const row = el('button', { class: 'tab-row', role: 'option' },
          el('span', { class: 'fav fav-letter', text: '★' }),
          el('span', { class: 'tab-main' },
            el('span', { class: 'tab-title', text: ws.name }),
            el('span', { class: 'tab-host', text: `${ws.tabs.length} tabs · workspace` })
          )
        );
        row.addEventListener('click', async () => {
          try {
            const res = await openWorkspace(ws, 'group');
            toast(`Opened ${res.opened} tabs from “${ws.name}”.`, { type: 'success' });
            window.close();
          } catch (e) {
            toast(friendly(e), { type: 'error' });
          }
        });
        resultsEl.appendChild(row);
      }
    }
  }
}

/* ------------------------------- organize -------------------------------- */

organizeBtn.addEventListener('click', async () => {
  organizeBtn.disabled = true;
  try {
    const a = await ensureAnalysis(true);
    const groups = a && a.suggestions.length ? buildGroupsFromSuggestions(a.suggestions) : [];
    if (!groups.length) {
      panelEl.hidden = false;
      clear(panelEl).appendChild(
        el('div', { class: 'popup-hint', text: 'Your tabs already look organized.' })
      );
      setTimeout(() => { panelEl.hidden = true; clear(panelEl); }, 2500);
      return;
    }
    // Compact review: the popup itself is the review step.
    actionsEl.hidden = true;
    panelEl.hidden = false;
    const total = groups.reduce((n, g) => n + g.tabIds.length, 0);
    clear(panelEl).append(
      el('div', { class: 'search-label', text: `Suggested organization — ${groups.length} groups · ${total} tabs` }),
      el('div', { class: 'suggest-list' },
        groups.map((g) => el('div', { class: 'tab-row' },
          el('span', { class: 'group-dot', style: `background:${GROUP_COLOR_HEX[g.color] || '#8e9297'}` }),
          el('span', { class: 'tab-main' },
            el('span', { class: 'tab-title', text: g.name }),
            el('span', { class: 'tab-host', text: `${g.tabIds.length} tabs` })
          )
        ))
      ),
      el('div', { class: 'btn-row', style: 'margin:10px 0' },
        el('button', {
          class: 'btn btn-primary', style: 'flex:1', text: `Organize ${total} tabs`,
          onclick: async () => {
            try {
              const result = await applyGroups(groups);
              reportOrganizeResult(result);
              await refreshTabs();
              renderStats();
            } catch (e) {
              toast(friendly(e), { type: 'error', timeout: 9000 });
            }
            panelEl.hidden = true;
            clear(panelEl);
            actionsEl.hidden = false;
          }
        })
      ),
      el('div', { class: 'btn-row', style: 'margin-bottom:10px' },
        el('button', {
          class: 'btn btn-ghost btn-sm', text: 'Review & edit in Dashboard',
          onclick: () => openDashboard('suggestions')
        }),
        el('button', {
          class: 'btn btn-ghost btn-sm', text: 'Cancel',
          onclick: () => { panelEl.hidden = true; clear(panelEl); actionsEl.hidden = false; }
        })
      )
    );
  } catch (e) {
    toast(friendly(e), { type: 'error', timeout: 9000 });
  } finally {
    organizeBtn.disabled = false;
  }
});

// Stash all tabs (panic button): CONFIRM first (it closes every tab), then
// snapshot → close → fresh tab. Runs in the service worker so it completes
// even if the popup is dismissed mid-flight. Success toast carries an Undo.
document.getElementById('popup-stash')?.addEventListener('click', async () => {
  const btn = document.getElementById('popup-stash');
  const { ok } = await confirmDialog({
    title: 'Stash ALL tabs?',
    message: `This closes every open tab (except pinned ones) after saving a full snapshot. Music, videos and forms will STOP playing/editing until you reopen them.`,
    html: el('p', { class: 'modal-text', text: 'Reopen everything anytime: History → the “before stash” snapshot → Restore. Or press Undo right after.' }),
    confirmLabel: 'Stash everything',
    cancelLabel: 'Keep my tabs',
    danger: true
  });
  if (!ok) return;
  btn.disabled = true;
  btn.textContent = 'Stashing…';
  try {
    const res = await chrome.runtime.sendMessage({ type: 'stash-all' });
    toast(`Stashed ${res?.stashed ?? 0} tabs. Snapshot saved.`, {
      type: 'success',
      timeout: 12000,
      actionLabel: 'Undo stash',
      onAction: async () => {
        try {
          const { getSnapshot, restoreSnapshot } = await import('../core/snapshots.js');
          const snap = await getSnapshot(res.snapshotId);
          if (snap) {
            const r = await restoreSnapshot(snap, { closeExtraneous: true });
            toast(`Restored ${r.opened} tabs.`, { type: 'success' });
          }
        } catch (err) {
          toast(friendly(err), { type: 'error', timeout: 9000 });
        }
      }
    });
  } catch (e) {
    toast(friendly(e), { type: 'error', timeout: 9000 });
  } finally {
    btn.disabled = false;
    btn.textContent = '📌 Stash all tabs';
  }
});

undoBtn.addEventListener('click', async () => {
  try {
    await undoOrganize();
    toast('Previous layout restored.', { type: 'success' });
    await refreshTabs();
    renderStats();
  } catch (e) {
    toast(friendly(e), { type: 'error' });
  }
});

/* --------------------------------- links --------------------------------- */

function openDashboard(view) {
  const url = chrome.runtime.getURL('src/ui/dashboard.html') + '#' + (view || 'overview');
  chrome.tabs.create({ url });
  window.close();
}

for (const btn of document.querySelectorAll('.link-btn[data-nav]')) {
  btn.addEventListener('click', () => openDashboard(btn.dataset.nav));
}

// Open the persistent side panel (stays open while browsing — Chrome kills
// this popup on outside clicks, the panel doesn't).
// IMPORTANT: chrome.sidePanel.open() requires a live user gesture. Sending a
// message to the service worker (or awaiting anything first) destroys the
// gesture context and the open() silently fails. So the popup calls open()
// DIRECTLY in the click handler — the click itself is the gesture.
const pinBtn = document.getElementById('popup-sidepanel');
if (pinBtn) {
  pinBtn.addEventListener('click', () => {
    chrome.windows.getLastFocused((w) => {
      const windowId = w?.id;
      const p = windowId != null
        ? chrome.sidePanel.open({ windowId })
        : chrome.sidePanel.open({});
      Promise.resolve(p).then(() => window.close()).catch((e) => {
        // Older Chrome without sidePanel API → fall back to the dashboard.
        console.warn('[TabVault] sidePanel.open failed:', e);
        const url = chrome.runtime.getURL('src/ui/dashboard.html') + '#overview';
        chrome.tabs.create({ url });
        window.close();
      });
    });
  });
}

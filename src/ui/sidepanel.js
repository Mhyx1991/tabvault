// TabVault side panel — the persistent companion UI.
// Unlike the popup, the side panel NEVER gets dismissed by Chrome, so:
//  - ✕ closes tabs immediately (no queue, no flush-on-close dance)
//  - stats/list stay live while you browse (tabs listeners below)
// Shares the same store, search, flows and components as popup/dashboard.

import {
  store, loadCore, refreshTabs, ensureAnalysis, protectionStatus,
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

const searchInput = document.getElementById('sp-search-input');
const resultsEl = document.getElementById('sp-results');
const panelEl = document.getElementById('sp-panel');
const actionsEl = document.getElementById('sp-actions');
const organizeBtn = document.getElementById('sp-organize');
const undoBtn = document.getElementById('sp-undo');
const closebarHost = document.getElementById('sp-closebar-host');

const searchIcon = document.querySelector('[data-icon="search"]');
if (searchIcon) searchIcon.innerHTML = icon('search', 15); // guard: missing element must not kill the panel

/* --------------------------------- boot --------------------------------- */

(async function boot() {
  try {
    await loadCore();
  } catch (e) {
    logError('sidepanel boot', e);
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

/* -------------------------------- stats --------------------------------- */

function renderStats() {
  const stats = document.getElementById('sp-stats');
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
  const chip = document.getElementById('sp-protection');
  chip.className = `protect-chip ${p.className}`;
  clear(chip).appendChild(el('span', { class: 'dot' }));
  chip.appendChild(document.createTextNode(p.label));

  undoBtn.hidden = !store.meta?.lastOrganize;
}

/* ------------------------------- recents -------------------------------- */

function renderRecents() {
  clear(resultsEl);
  const hits = searchTabs('', store.tabs, store.groups);
  if (!hits.length) {
    resultsEl.appendChild(el('div', { class: 'sp-hint', text: "You're all clear. No tabs to organize." }));
    return;
  }
  for (const { tab } of hits) resultsEl.appendChild(resultRow(tab));
}

function resultRow(tab) {
  const g = tab.groupId !== -1 && store.groups.has(tab.groupId) ? store.groups.get(tab.groupId) : null;
  const row = el('div', { class: 'tab-row', role: 'option', tabindex: '0' },
    faviconEl(tab.url),
    el('span', { class: 'tab-main' },
      el('span', { class: 'tab-title', text: tab.title || tab.url }),
      el('span', { class: 'tab-subline' },
        el('span', { class: 'tab-host', text: tab.host }),
        g ? badge(g.title || 'Group', 'muted') : null
      )
    ),
    // Side panel never dismisses → close immediately, then refresh in place.
    closeTabBtn(tab, { onClosed: onTabClosed })
  );
  const activate = async () => {
    await activateTab(tab.id);
  };
  row.addEventListener('click', activate);
  row.addEventListener('keydown', (e) => { if (e.key === 'Enter') activate(); });
  return row;
}

async function onTabClosed(tab) {
  await refreshTabs();
  renderStats();
  runSearch();
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
  }
});

function runSearch() {
  const q = searchInput.value.trim();
  clear(resultsEl);
  const tabHits = searchTabs(q, store.tabs, store.groups);
  if (q && !tabHits.length) {
    resultsEl.appendChild(el('div', { class: 'sp-hint', text: `No open tabs match “${q}”.` }));
    return;
  }
  const label = q ? `Open tabs (${tabHits.length})` : 'Recent tabs';
  resultsEl.appendChild(el('div', { class: 'sp-label', text: label }));
  const shown = q ? 40 : 12;
  for (const { tab } of tabHits.slice(0, shown)) resultsEl.appendChild(resultRow(tab));
  if (tabHits.length > shown) {
    const more = el('button', { class: 'btn btn-ghost btn-block', text: `Show all ${tabHits.length}` });
    more.addEventListener('click', () => {
      clear(resultsEl);
      resultsEl.appendChild(el('div', { class: 'sp-label', text: label }));
      for (const { tab } of tabHits) resultsEl.appendChild(resultRow(tab));
    });
    resultsEl.appendChild(more);
  }

  if (q) {
    const wsHits = searchWorkspaces(q, store.workspaces);
    if (wsHits.length) {
      resultsEl.appendChild(el('div', { class: 'sp-label', text: 'Workspaces' }));
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
            await refreshTabs();
            renderStats();
          } catch (e) {
            toast(friendly(e), { type: 'error' });
          }
        });
        resultsEl.appendChild(row);
      }
    }
  }
}

/* ------------------------------- organize ------------------------------- */

organizeBtn.addEventListener('click', async () => {
  organizeBtn.disabled = true;
  try {
    const a = await ensureAnalysis(true);
    const groups = a && a.suggestions.length ? buildGroupsFromSuggestions(a.suggestions) : [];
    if (!groups.length) {
      panelEl.hidden = false;
      clear(panelEl).appendChild(
        el('div', { class: 'sp-hint', text: 'Your tabs already look organized.' })
      );
      setTimeout(() => { panelEl.hidden = true; clear(panelEl); }, 2500);
      return;
    }
    actionsEl.hidden = true;
    panelEl.hidden = false;
    const total = groups.reduce((n, g) => n + g.tabIds.length, 0);
    clear(panelEl).append(
      el('div', { class: 'sp-label', text: `Suggested — ${groups.length} groups · ${total} tabs` }),
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
              runSearch();
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

// Stash all (panic button) — CONFIRM first (danger action), then worker-side.
document.getElementById('sp-stash')?.addEventListener('click', async () => {
  const btn = document.getElementById('sp-stash');
  const { ok } = await confirmDialog({
    title: 'Stash ALL tabs?',
    message: 'This closes every open tab (except pinned ones) after saving a full snapshot. Music, videos and forms will STOP until you reopen them.',
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
            await refreshTabs();
            renderStats();
          }
        } catch (err) {
          toast(friendly(err), { type: 'error', timeout: 9000 });
        }
      }
    });
    await refreshTabs();
    renderStats();
    runSearch();
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
    runSearch();
  } catch (e) {
    toast(friendly(e), { type: 'error' });
  }
});

/* --------------------------------- links --------------------------------- */

function openDashboard(view) {
  const url = chrome.runtime.getURL('src/ui/dashboard.html') + '#' + (view || 'overview');
  chrome.tabs.create({ url });
}

for (const btn of document.querySelectorAll('.link-btn[data-nav]')) {
  btn.addEventListener('click', () => openDashboard(btn.dataset.nav));
}

/* ---------------------------- live updates -------------------------------
 * The side panel stays open while the user browses, so keep it fresh.
 * Debounced hard: tab events fire in bursts while pages load.             */

let refreshTimer = null;
function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(async () => {
    await refreshTabs();
    renderStats();
    runSearch();
  }, 500);
}

chrome.tabs.onCreated.addListener(scheduleRefresh);
chrome.tabs.onRemoved.addListener(scheduleRefresh);
chrome.tabs.onUpdated.addListener(scheduleRefresh);
chrome.tabs.onMoved.addListener(scheduleRefresh);
try {
  chrome.tabGroups.onUpdated.addListener(scheduleRefresh);
  chrome.tabGroups.onRemoved.addListener(scheduleRefresh);
} catch { /* optional */ }
chrome.windows.onCreated.addListener(scheduleRefresh);
chrome.windows.onRemoved.addListener(scheduleRefresh);

/* --------------------------- quick switcher ------------------------------
 * Tabli-grade keyboard flow: '/' or Ctrl+K focuses search, arrows move,
 * Enter activates, first result is the top hit. '/' is also used by the
 * dashboard; here it's safe because the search input is the primary focus. */
document.addEventListener('keydown', (e) => {
  const inInput = e.target?.closest?.('input, textarea, select'); // guard: target may be Document
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    searchInput.focus();
    searchInput.select();
    return;
  }
  if (e.key === '/' && !inInput) {
    e.preventDefault();
    searchInput.focus();
    return;
  }
  if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && resultsEl.querySelector('.tab-row')) {
    e.preventDefault();
    const rows = [...resultsEl.querySelectorAll('.tab-row')];
    const idx = rows.indexOf(document.activeElement);
    const next = e.key === 'ArrowDown'
      ? rows[Math.min(rows.length - 1, idx + 1)] || rows[0]
      : rows[Math.max(0, idx - 1)] || rows[0];
    next?.focus();
  }
});

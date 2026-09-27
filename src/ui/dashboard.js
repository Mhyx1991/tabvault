// TabVault dashboard — app shell, routing, global search, live updates.

import {
  store, subscribe, loadCore, refreshData, refreshTabs, ensureAnalysis,
  protectionStatus, dismissed, applyGroups, acceptSuggestions, undoOrganize,
  buildGroupsFromSuggestions
} from './store.js';
import { el, clear, icon, faviconEl, badge, closeTabBtn } from './components.js';
import { friendly, logError } from '../core/errors.js';
import { activateTab } from '../core/tabs.js';
import { searchTabs, searchWorkspaces } from '../core/search.js';
import { debounce } from '../shared/utils.js';
import { GROUP_COLOR_HEX } from '../shared/constants.js';

import { render as renderOverview } from './views/overview.js';
import { render as renderSuggestions } from './views/suggestions.js';
import { render as renderWorkspaces } from './views/workspaces.js';
import { render as renderHistory } from './views/history.js';
import { render as renderCare } from './views/care.js';
import { render as renderSettings } from './views/settings.js';
import { render as renderPrivacy } from './views/privacy.js';

const VIEWS = {
  overview: renderOverview,
  suggestions: renderSuggestions,
  workspaces: renderWorkspaces,
  history: renderHistory,
  care: renderCare,
  settings: renderSettings,
  privacy: renderPrivacy
};

const viewRoot = document.getElementById('view');
let currentView = 'overview';

const ctx = {
  store,
  navigate,
  rerender: () => render(),
  ensureAnalysis,
  dismissed,
  applyGroups,
  acceptSuggestions,
  undoOrganize,
  refreshData,
  buildGroupsFromSuggestions
};

/* --------------------------------- routing --------------------------------- */

export function navigate(hash) {
  if (location.hash === '#' + hash) render();
  else location.hash = '#' + hash;
}

function routeFromHash() {
  const name = (location.hash || '#overview').replace(/^#/, '');
  return VIEWS[name] ? name : 'overview';
}

function render() {
  currentView = routeFromHash();
  for (const btn of document.querySelectorAll('.nav-item')) {
    const active = btn.dataset.view === currentView;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-current', active ? 'page' : 'false');
  }
  clear(viewRoot);
  Promise.resolve(VIEWS[currentView](viewRoot, ctx)).catch((e) => {
    logError(`render ${currentView}`, e);
    clear(viewRoot).appendChild(
      el('div', { class: 'empty' },
        el('div', { class: 'empty-icon', html: icon('alert', 28) }),
        el('h3', { class: 'empty-title', text: 'Something went wrong' }),
        el('p', { class: 'empty-text', text: friendly(e) }),
        el('div', { class: 'btn-row center' },
          el('button', { class: 'btn btn-primary', text: 'Try again', onclick: () => render() }))
      )
    );
  });
  updateNavCounts();
}

function updateNavCounts() {
  const suggestN = store.analysis ? store.analysis.suggestions.length : 0;
  setCount('nav-suggest', suggestN);
  const careN = store.dupTabCount + (store.stale?.stale.length || 0);
  setCount('nav-care', careN);
}

function setCount(id, n) {
  const node = document.getElementById(id);
  if (!node) return;
  node.hidden = !n;
  node.textContent = String(n);
}

/* ------------------------------ header bits -------------------------------- */

function updateProtection() {
  const chip = document.getElementById('protection-chip');
  if (!chip) return;
  const p = protectionStatus();
  chip.className = `protect-chip ${p.className}`;
  clear(chip).appendChild(el('span', { class: 'dot' }));
  chip.appendChild(document.createTextNode(p.label));
}

function updateStorageStatus() {
  const node = document.getElementById('storage-status');
  if (!node) return;
  node.textContent = '';
}

/* ------------------------------ global search ------------------------------ */

const searchInput = document.getElementById('global-search');
const searchResults = document.getElementById('search-results');
const searchIcon = document.querySelector('[data-icon="search"]');
if (searchIcon) searchIcon.innerHTML = icon('search', 16); // guard: missing element must not kill the dashboard

function runSearch() {
  const q = searchInput.value.trim();
  if (!q) { closeSearch(); return; }
  clear(searchResults);
  searchResults.hidden = false;

  const tabHits = searchTabs(q, store.tabs, store.groups);
  const wsHits = searchWorkspaces(q, store.workspaces);

  if (!tabHits.length && !wsHits.length) {
    searchResults.appendChild(el('div', { class: 'search-label', text: `No tabs or workspaces match “${q}”` }));
    return;
  }

  if (tabHits.length) {
    searchResults.appendChild(el('div', { class: 'search-label', text: `Open tabs (${tabHits.length})` }));
    for (const { tab } of tabHits.slice(0, 12)) {
      const g = tab.groupId !== -1 && store.groups.has(tab.groupId) ? store.groups.get(tab.groupId) : null;
      const row = el('div', {
        class: 'tab-row', role: 'option', tabindex: '0', style: 'width:100%;text-align:left;cursor:pointer',
        onclick: async () => { closeSearch(); searchInput.value = ''; await activateTab(tab.id); },
        onkeydown: (e) => { if (e.key === 'Enter') { closeSearch(); searchInput.value = ''; activateTab(tab.id); } }
      },
        faviconEl(tab.url),
        el('span', { class: 'tab-main' },
          el('span', { class: 'tab-title', text: tab.title || tab.url }),
          el('span', { class: 'tab-subline' },
            el('span', { class: 'tab-host', text: tab.host }),
            g ? badge(g.title || 'Group', 'muted') : null
          )
        ),
        g ? el('span', { class: 'group-dot', style: `background:${GROUP_COLOR_HEX[g.color] || '#8e9297'}` }) : null,
        closeTabBtn(tab, { onClosed: async (t) => {
          await refreshTabs();
          runSearch(); // re-render results without the closed tab
        } })
      );
      searchResults.appendChild(row);
    }
  }
  if (wsHits.length) {
    searchResults.appendChild(el('div', { class: 'search-label', text: 'Workspaces' }));
    for (const { workspace: ws } of wsHits) {
      searchResults.appendChild(el('button', {
        class: 'tab-row', style: 'width:100%;text-align:left;border:none;background:none;cursor:pointer',
        onclick: () => { closeSearch(); searchInput.value = ''; navigate('workspaces'); }
      },
        el('span', { class: 'fav fav-letter', text: '★' }),
        el('span', { class: 'tab-main' },
          el('span', { class: 'tab-title', text: ws.name }),
          el('span', { class: 'tab-host', text: `${ws.tabs.length} tabs · saved workspace` })
        )
      ));
    }
  }
}

function closeSearch() {
  searchResults.hidden = true;
  clear(searchResults);
}

searchInput.addEventListener('input', debounce(runSearch, 90));
searchInput.addEventListener('focus', () => { if (searchInput.value.trim()) runSearch(); });
searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closeSearch(); searchInput.blur(); }
  if (e.key === 'Enter') {
    const first = searchResults.querySelector('.tab-row');
    if (first) first.click();
  }
});
document.addEventListener('click', (e) => {
  if (e.target?.closest && !e.target.closest('#searchbar')) closeSearch();
});
document.addEventListener('keydown', (e) => {
  // e.target can be Document for synthetic/programmatic events — guard closest().
  const inField = e.target?.closest?.('input, textarea, select, [contenteditable]');
  if (e.key === '/' && !inField) {
    e.preventDefault();
    searchInput.focus();
    searchInput.select();
  }
});

/* --------------------------------- theme ----------------------------------- */

const themeQuery = window.matchMedia('(prefers-color-scheme: dark)');
function applyTheme() {
  const t = store.settings?.theme || 'system';
  const dark = t === 'dark' || (t === 'system' && themeQuery.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}
themeQuery.addEventListener('change', () => { if (store.settings?.theme === 'system') applyTheme(); });

/* ------------------------------- live updates ------------------------------ */

const onTabsChanged = debounce(async () => {
  await refreshTabs();
  updateProtection();
  render();
}, 600);

chrome.tabs.onCreated.addListener(onTabsChanged);
chrome.tabs.onRemoved.addListener(onTabsChanged);
chrome.tabs.onUpdated.addListener(onTabsChanged);
chrome.tabs.onMoved.addListener(onTabsChanged);
chrome.tabs.onAttached.addListener(onTabsChanged);
chrome.tabs.onDetached.addListener(onTabsChanged);
try {
  chrome.tabGroups.onUpdated.addListener(onTabsChanged);
  chrome.tabGroups.onRemoved.addListener(onTabsChanged);
} catch { /* tabGroups events optional */ }
chrome.windows.onCreated.addListener(onTabsChanged);
chrome.windows.onRemoved.addListener(onTabsChanged);

/* ---------------------------------- boot ----------------------------------- */

for (const btn of document.querySelectorAll('.nav-item')) {
  btn.addEventListener('click', () => navigate(btn.dataset.view));
}
window.addEventListener('hashchange', render);
document.getElementById('app-version').textContent = chrome.runtime.getManifest().version;

(async function boot() {
  try {
    await loadCore();
    await ensureAnalysis();
  } catch (e) {
    logError('boot', e);
  }
  applyTheme();
  updateProtection();
  updateStorageStatus();
  render();

  // First-run tutorial: 3 steps, skippable, shown once after onboarding.
  try {
    const { shouldShowTutorial, startTutorial } = await import('./tutorial.js');
    if (shouldShowTutorial(store.settings)) {
      await startTutorial(ctx);
    }
  } catch (e) {
    logError('tutorial', e);
  }

  subscribe(() => {
    applyTheme();
    updateProtection();
    updateNavCounts();
    // Store data changed (workspace saved/deleted, snapshot taken, etc.) —
    // re-render the current view so the UI shows it WITHOUT a manual refresh.
    render();
  });
})();

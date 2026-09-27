// Suggestions — review and edit the proposed organization before applying.

import {
  el, clear, badge, card, sectionHead, emptyState, toast, menuBtn, tabRow, confirmDialog, promptDialog, openModal
} from '../components.js';
import { store, ensureAnalysis, dismissed, dismissSuggestions, createDomainRule, updateSettings } from '../store.js';
import { buildGroupsFromSuggestions } from '../../core/organize.js';
import { confirmAndOrganize } from '../flows.js';
import { CATEGORIES, GROUP_COLOR_HEX, LIMITS } from '../../shared/constants.js';
import { updateTabsSafe, ungroupTabs, activateTab } from '../../core/tabs.js';
import { friendly, logError } from '../../core/errors.js';
import { uid } from '../../shared/utils.js';

// Working plan (edited suggestions) — rebuilt when the tab set changes.
let planCache = null;
let planFp = null;
const selected = new Set();

function buildPlan() {
  const a = store.analysis;
  const plan = (a?.suggestions || []).map((s) => ({ ...s }));
  if (a?.unsorted) plan.push({ ...a.unsorted, tabs: a.unsorted.tabs.slice() });
  return plan;
}

function getPlan(ctx) {
  if (!planCache || planFp !== store.analysisFp) {
    planCache = buildPlan();
    planFp = store.analysisFp;
    selected.clear();
  }
  return planCache;
}

export async function render(root, ctx) {
  const a = await ctx.ensureAnalysis();

  if (store.settings && store.settings.autoSuggest === false) {
    root.appendChild(emptyState({
      iconName: 'check',
      title: 'Suggestions are turned off',
      text: 'Turn them back on in Settings → Organization to let TabVault propose groups.',
      actions: [el('button', { class: 'btn btn-primary', text: 'Open Settings', onclick: () => ctx.navigate('settings') })]
    }));
    return;
  }
  if (!a) {
    root.appendChild(emptyState({
      title: 'Nothing to analyze yet',
      text: 'Open a few tabs and come back.'
    }));
    return;
  }

  if (ctx.dismissed()) {
    root.appendChild(emptyState({
      iconName: 'check',
      title: 'Your tabs already look organized.',
      text: 'You dismissed the suggestions for this set of tabs. Nothing was changed.',
      actions: [
        el('button', {
          class: 'btn btn-primary', text: 'Re-analyze',
          onclick: async () => {
            store.meta = { ...store.meta, dismissedFingerprint: null };
            await ensureAnalysis(true);
            ctx.rerender();
          }
        })
      ]
    }));
    return;
  }

  const plan = getPlan(ctx);
  // Empty CUSTOM groups must stay visible: the user just created them and is
  // about to add tabs. Categories with 0 tabs remain hidden (noise).
  const groups = plan.filter((s) => s.kind !== 'unsorted' && (s.tabs.length > 0 || s.kind === 'custom'));
  const unsorted = plan.find((s) => s.kind === 'unsorted');
  const totalTabs = groups.reduce((n, s) => n + s.tabs.length, 0);

  /* header */
  root.appendChild(sectionHead('Suggested organization',
    el('button', {
      class: 'btn btn-ghost btn-sm', text: 'Re-analyze',
      onclick: async () => { await ensureAnalysis(true); ctx.rerender(); }
    }),
    el('button', {
      class: 'btn btn-ghost btn-sm', text: 'Ignore suggestions',
      onclick: async () => { await dismissSuggestions(); ctx.rerender(); }
    }),
    el('button', { class: 'btn btn-secondary btn-sm', text: '+ New group', onclick: () => createCustomGroup(ctx) }),
    el('button', {
      class: 'btn btn-primary btn-sm', text: 'Apply All',
      disabled: !groups.length,
      onclick: async () => {
        const result = await confirmAndOrganize(buildGroupsFromSuggestions(groups), { title: `Create ${groups.length} groups?` });
        if (result) ctx.rerender();
      }
    })
  ));

  if (!groups.length) {
    root.appendChild(emptyState({
      iconName: 'check',
      title: 'Your tabs already look organized.',
      text: unsorted && unsorted.tabs.length
        ? `${unsorted.tabs.length} tab${unsorted.tabs.length === 1 ? '' : 's'} couldn't be confidently grouped — they're kept in Unsorted below.`
        : 'Nothing new to suggest right now.'
    }));
  } else {
    root.appendChild(el('p', { class: 'section-sub', style: 'margin:-6px 0 14px', text: `${totalTabs} tabs in ${groups.length} groups · edit freely, then apply. A snapshot is saved automatically.` }));
  }

  if (groups.length) {
    const grid = el('div', { class: 'suggest-grid' });
    for (const s of groups) grid.appendChild(suggestCard(s, plan, ctx));
    root.appendChild(grid);
  }

  /* existing chrome groups (preserved) */
  if (a.existingGroups.length && store.settings.preserveExistingGroups) {
    root.appendChild(sectionHead('Existing Chrome groups',
      badge(`${a.existingGroups.length} preserved`, 'muted')
    ));
    const c = card();
    for (const g of a.existingGroups) {
      c.appendChild(el('div', { class: 'history-row' },
        el('span', { class: 'group-dot', style: `background:${GROUP_COLOR_HEX[g.color] || '#8e9297'}` }),
        el('div', { class: 'history-info' },
          el('div', { class: 'history-counts', text: g.title || 'Group' }),
          el('div', { class: 'history-trigger', text: `${g.count} tab${g.count === 1 ? '' : 's'} · kept as-is` })
        ),
        el('button', {
          class: 'btn btn-danger-ghost btn-sm', text: 'Ungroup',
          onclick: async () => {
            const { ok } = await confirmDialog({
              title: `Ungroup “${g.title}”?`,
              message: `${g.count} tabs will be removed from this Chrome group. The tabs stay open.`,
              confirmLabel: 'Ungroup tabs', danger: true
            });
            if (!ok) return;
            await ungroupTabs(g.tabs.map((t) => t.id));
            toast('Group removed. Tabs stayed open.', { type: 'success' });
            ctx.rerender();
          }
        })
      ));
    }
    root.appendChild(c);
  }

  /* unsorted card */
  if (unsorted) {
    root.appendChild(sectionHead(unsorted.tabs.length ? 'Unsorted' : '', unsorted.tabs.length ? badge(`${unsorted.tabs.length} tabs`, 'muted') : null));
    if (unsorted.tabs.length) {
      root.appendChild(el('p', { class: 'section-sub', style: 'margin:-6px 0 12px', text: "We couldn't confidently organize these tabs. Move them into a group, or leave them as they are." }));
      root.appendChild(unsortedCard(unsorted, plan, ctx));
    }
  }

  renderSelectionBar(root, ctx);
}

/* ------------------------------- group cards ------------------------------ */

function suggestCard(s, plan, ctx) {
  const c = card('suggest-card');
  const confBadge = s.confidence && s.confidence !== 'unsorted'
    ? badge(s.confidence, s.confidence === 'high' ? 'success' : s.confidence === 'medium' ? 'accent' : 'muted')
    : null;

  c.appendChild(el('div', { class: 'suggest-head' },
    el('span', { class: 'suggest-emoji', text: s.emoji }),
    el('span', { class: 'suggest-name', text: s.name }),
    confBadge,
    el('span', { class: 'suggest-count', text: `${s.tabs.length} tab${s.tabs.length === 1 ? '' : 's'}` }),
    menuBtn({
      ariaLabel: `Group options for ${s.name}`,
      items: [
        { label: 'Rename group', value: 'rename' },
        { label: 'Merge into…', value: 'merge' },
        { separator: true },
        { label: 'Apply this group', value: 'apply' }
      ],
      onPick: async (v) => {
        if (v === 'rename') {
          const name = await promptDialog({ title: 'Rename group', label: 'Group name', value: s.name });
          if (name) { s.name = name; if (s.kind === 'category') await saveCategoryName(s.categoryId, name); ctx.rerender(); }
        } else if (v === 'merge') {
          mergeGroup(s, plan, ctx);
        } else if (v === 'apply') {
          const result = await confirmAndOrganize(buildGroupsFromSuggestions([s]), { title: `Create “${s.name}”?` });
          if (result) ctx.rerender();
        }
      }
    })
  ));

  const list = el('div', { class: 'suggest-list' });
  const limited = s.tabs.slice(0, LIMITS.LIST_RENDER);
  for (const t of limited) {
    list.appendChild(tabRow(t, {
      selectable: true,
      selected: selected.has(t.id),
      onToggle: (id, on) => { on ? selected.add(id) : selected.delete(id); renderSelectionBarLive(ctx); },
      onOpen: (tab) => activateTab(tab.id),
      reason: t._cls?.reasons?.[0],
      menu: tabMenuItems(s, plan),
      onMenu: (value, tab) => handleTabMenu(value, tab, s, plan, ctx)
    }));
  }
  if (s.tabs.length > limited.length) {
    list.appendChild(el('div', { class: 'tab-row', style: 'color:var(--text-faint);font-size:12.5px', text: `+ ${s.tabs.length - limited.length} more` }));
  }
  c.appendChild(list);

  c.appendChild(el('div', { class: 'suggest-foot' },
    el('span', { class: 'tab-host', text: s.kind === 'custom' ? (s.tabs.length ? 'Custom group' : 'Custom group — add tabs from Unsorted via their ⋯ menu') : (s.hint || 'Chrome tab group') }),
    el('button', {
      class: 'btn btn-primary btn-sm', text: `Apply ${s.tabs.length}`,
      disabled: !s.tabs.length,
      onclick: async () => {
        const result = await confirmAndOrganize(buildGroupsFromSuggestions([s]), { title: `Create “${s.name}”?` });
        if (result) ctx.rerender();
      }
    })
  ));
  return c;
}

function unsortedCard(unsorted, plan, ctx) {
  const c = card('suggest-card');
  const list = el('div', { class: 'suggest-list' });
  const limited = unsorted.tabs.slice(0, LIMITS.LIST_RENDER);
  for (const t of limited) {
    list.appendChild(tabRow(t, {
      selectable: true,
      selected: selected.has(t.id),
      onToggle: (id, on) => { on ? selected.add(id) : selected.delete(id); renderSelectionBarLive(ctx); },
      onOpen: (tab) => activateTab(tab.id),
      menu: tabMenuItems(unsorted, plan),
      onMenu: (value, tab) => handleTabMenu(value, tab, unsorted, plan, ctx)
    }));
  }
  if (unsorted.tabs.length > limited.length) {
    list.appendChild(el('div', { class: 'tab-row', style: 'color:var(--text-faint);font-size:12.5px', text: `+ ${unsorted.tabs.length - limited.length} more` }));
  }
  c.appendChild(el('div', { class: 'suggest-head' },
    el('span', { class: 'suggest-emoji', text: '📦' }),
    el('span', { class: 'suggest-name', text: 'Unsorted' }),
    el('span', { class: 'suggest-count', text: `${unsorted.tabs.length} tab${unsorted.tabs.length === 1 ? '' : 's'}` })
  ));
  c.appendChild(list);
  return c;
}

/* -------------------------------- tab menu -------------------------------- */

function tabMenuItems(sourceGroup, plan) {
  const items = [{ label: 'Open tab', value: 'open' }, { separator: true }];
  for (const cat of CATEGORIES) {
    if (sourceGroup.kind === 'category' && cat.id === sourceGroup.categoryId) continue;
    items.push({ label: `Move to ${cat.name} ${cat.emoji}`, value: `move:${cat.id}` });
  }
  if (sourceGroup.kind !== 'unsorted') items.push({ label: 'Move to Unsorted 📦', value: 'move:unsorted' });
  items.push({ label: 'New group from selection…', value: 'newgroup', disabled: selected.size === 0 });
  if (sourceGroup.kind === 'category') {
    items.push({ separator: true }, { label: 'Always file this site here', value: 'rule' });
  }
  items.push({ separator: true }, { label: 'Pin tab', value: 'pin' });
  return items;
}

async function handleTabMenu(value, tab, sourceGroup, plan, ctx) {
  try {
    if (value === 'open') return activateTab(tab.id);
    if (value === 'pin') {
      await updateTabsSafe([tab.id], { pinned: true });
      toast('Tab pinned.', { timeout: 2500 });
      return;
    }
    if (value === 'rule') {
      await createDomainRule(tab.host, sourceGroup.categoryId);
      toast(`Rule saved: ${tab.host} will always be filed under ${sourceGroup.name}.`, { type: 'success' });
      return;
    }
    if (value === 'newgroup') {
      await createCustomGroup(ctx, [...selected]);
      return;
    }
    if (value.startsWith('move:')) {
      const targetId = value.slice(5);
      moveTabsTo(targetId, [tab.id], plan);
      ctx.rerender();
    }
  } catch (e) {
    logError('suggestion tab menu', e);
    toast(friendly(e), { type: 'error' });
  }
}

function moveTabsTo(targetId, tabIds, plan) {
  const target = plan.find((s) => (targetId === 'unsorted' ? s.kind === 'unsorted' : s.categoryId === targetId));
  if (!target) return;
  for (const id of tabIds) {
    // remove from every group in the plan
    for (const s of plan) {
      const idx = s.tabs.findIndex((t) => t.id === id);
      if (idx !== -1) { s.tabs.splice(idx, 1); }
    }
    const tab = findTab(id);
    if (tab) target.tabs.push(tab);
  }
  // drop empty category cards
  for (let i = plan.length - 1; i >= 0; i--) {
    const s = plan[i];
    if (s.kind !== 'unsorted' && s.tabs.length === 0) plan.splice(i, 1);
  }
}

function findTab(id) {
  return store.tabs.find((t) => t.id === id) || null;
}

/* ------------------------------ group actions ----------------------------- */

async function saveCategoryName(categoryId, name) {
  const names = { ...(store.settings.categoryNames || {}) };
  names[categoryId] = name;
  await updateSettings({ categoryNames: names });
}

function mergeGroup(source, plan, ctx) {
  const others = plan.filter((s) => s !== source && s.kind !== 'unsorted' && s.tabs.length > 0);
  if (!others.length) { toast('There is no other group to merge into.', { timeout: 3000 }); return; }
  chooseFromList(`Merge “${source.name}” into…`, others.map((o) => ({ value: o, label: `${o.emoji} ${o.name} (${o.tabs.length} tabs)` })))
    .then(async (target) => {
      if (!target) return;
      target.tabs.push(...source.tabs);
      plan.splice(plan.indexOf(source), 1);
      toast(`Merged ${source.tabs.length} tabs into ${target.name}.`, { timeout: 3000 });
      ctx.rerender();
    });
}

function chooseFromList(title, options) {
  return new Promise((resolve) => {
    let settled = false;
    const body = el('div', { class: 'modal-list', style: 'padding:6px' });
    for (const opt of options) {
      body.appendChild(el('button', {
        class: 'menu-item', style: 'width:100%', text: opt.label,
        onclick: () => { settled = true; resolve(opt.value); m.close(); }
      }));
    }
    const m = openModal({
      title,
      body,
      footer: el('div', { class: 'btn-row end' }, el('button', { class: 'btn btn-secondary', text: 'Cancel', onclick: () => { settled = true; resolve(null); m.close(); } })),
      onClose: () => { if (!settled) resolve(null); }
    });
  });
}

async function createCustomGroup(ctx, tabIds = []) {
  const name = await promptDialog({ title: 'New group', label: 'Group name', placeholder: 'e.g. Job search', confirmLabel: 'Create group' });
  if (!name) return;
  const plan = getPlan(ctx);
  const group = {
    id: 'custom-' + uid(),
    kind: 'custom',
    categoryId: null,
    name,
    emoji: '📁',
    color: 'blue',
    confidence: 'high',
    tabs: [],
    tabIds: []
  };
  if (tabIds.length) {
    for (const id of tabIds) {
      for (const s of plan) {
        const idx = s.tabs.findIndex((t) => t.id === id);
        if (idx !== -1) s.tabs.splice(idx, 1);
      }
    }
    for (const id of tabIds) {
      const t = findTab(id);
      if (t) group.tabs.push(t);
    }
  }
  plan.unshift(group);
  selected.clear();
  toast(`Group “${name}” created. Add tabs, then Apply.`, { timeout: 3500 });
  ctx.rerender();
}

/* ------------------------------ selection bar ----------------------------- */

let selBarHost = null;

function renderSelectionBar(root, ctx) {
  selBarHost = { root, ctx };
  if (!selected.size) return;
  const bar = el('div', { class: 'selection-bar' },
    el('span', { class: 'notice-title', text: `${selected.size} tab${selected.size === 1 ? '' : 's'} selected` }),
    buildMoveSelect(ctx),
    el('button', { class: 'btn btn-ghost btn-sm', text: 'Clear', onclick: () => { selected.clear(); ctx.rerender(); } })
  );
  root.appendChild(bar);
}

function renderSelectionBarLive(ctx) {
  if (!selBarHost) return;
  const { root } = selBarHost;
  const old = root.querySelector('.selection-bar');
  if (old) old.remove();
  if (selected.size) {
    const bar = el('div', { class: 'selection-bar' },
      el('span', { class: 'notice-title', text: `${selected.size} tab${selected.size === 1 ? '' : 's'} selected` }),
      buildMoveSelect(ctx),
      el('button', { class: 'btn btn-ghost btn-sm', text: 'Clear', onclick: () => { selected.clear(); ctx.rerender(); } })
    );
    root.appendChild(bar);
  }
}

function buildMoveSelect(ctx) {
  const sel = el('select', { class: 'input', style: 'width:auto', 'aria-label': 'Move selected tabs to' },
    el('option', { value: '', text: 'Move to…' }),
    CATEGORIES.map((c) => el('option', { value: c.id, text: `${c.emoji} ${c.name}` })),
    el('option', { value: 'unsorted', text: '📦 Unsorted' }),
    el('option', { value: '__new__', text: '➕ New group…' })
  );
  sel.addEventListener('change', async () => {
    const v = sel.value;
    sel.value = '';
    if (!v) return;
    const plan = getPlan(ctx);
    if (v === '__new__') return createCustomGroup(ctx, [...selected]);
    moveTabsTo(v, [...selected], plan);
    selected.clear();
    ctx.rerender();
  });
  return sel;
}

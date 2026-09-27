// Care — duplicates and stale tabs. Nothing here acts without review.

import {
  el, card, sectionHead, emptyState, toast, badge, tabRow, confirmDialog, promptDialog, rel
} from '../components.js';
import { store, refreshTabs } from '../store.js';
import { closePlan } from '../../core/duplicates.js';
import { closeTabsWithProtection } from '../flows.js';
import { activateTab, groupTabsInWindow, applyGroupMeta } from '../../core/tabs.js';
import { createWorkspace } from '../../core/workspaces.js';
import { friendly, logError } from '../../core/errors.js';

export async function render(root, ctx) {
  renderDuplicates(root, ctx);
  renderSameSite(root, ctx);
  renderStale(root, ctx);
}

/* ------------------------------- duplicates ------------------------------- */

function renderDuplicates(root, ctx) {
  root.appendChild(sectionHead('Possible duplicates',
    store.dupTabCount > 0 ? badge(`${store.dupTabCount} extra copies`, 'warn') : null
  ));
  if (!store.duplicates.length) {
    root.appendChild(emptyState({
      iconName: 'copy',
      title: 'No duplicate tabs',
      text: 'When the same page is open several times, it shows up here.'
    }));
    return;
  }

  root.appendChild(el('p', { class: 'section-sub', style: 'margin:-6px 0 12px', text: 'Nothing is closed automatically. Review each group and decide.' }));

  const c = card();
  for (const g of store.duplicates.slice(0, 30)) {
    const { keep, close } = closePlan(g);
    c.appendChild(el('div', { class: 'dup-row' },
      el('div', { class: 'dup-info' },
        el('div', { class: 'dup-title', text: `${g.tabs.length} copies of the same page` }),
        el('div', { class: 'dup-sub', text: shorten(g.key, 90) })
      ),
      el('span', { class: 'tab-meta', text: `keep: ${keep.active ? 'active' : keep.pinned ? 'pinned' : 'most recent'}` }),
      el('button', {
        class: 'btn btn-danger-ghost btn-sm', text: `Close ${close.length}`,
        onclick: async () => {
          const res = await closeTabsWithProtection(close, {
            title: `Close ${close.length} duplicate${close.length === 1 ? '' : 's'}?`,
            message: `One copy stays open; the other ${close.length} cop${close.length === 1 ? 'y closes' : 'ies close'}. A snapshot is saved first.`
          });
          if (res != null) { await refreshTabs(); ctx.rerender(); }
        }
      })
    ));
  }
  if (store.duplicates.length > 30) {
    c.appendChild(el('div', { class: 'dup-row', style: 'color:var(--text-faint)', text: `+ ${store.duplicates.length - 30} more groups` }));
  }
  root.appendChild(c);

  const totalClose = store.duplicates.reduce((n, g) => n + g.tabs.length - 1, 0);
  root.appendChild(el('div', { class: 'btn-row', style: 'margin-top:12px' },
    el('button', {
      class: 'btn btn-danger-ghost', text: `Close all ${totalClose} extra copies`,
      onclick: async () => {
        const allClose = [];
        for (const g of store.duplicates) allClose.push(...closePlan(g).close);
        const res = await closeTabsWithProtection(allClose, {
          title: `Close ${allClose.length} duplicate tabs?`,
          message: 'One copy of each page stays open. A snapshot is saved first so you can restore them from History.'
        });
        if (res != null) { await refreshTabs(); ctx.rerender(); }
      }
    })
  ));
}

/* ------------------------------- same-site clusters ------------------------------- */

function renderSameSite(root, ctx) {
  const clusters = store.sameSiteClusters || [];
  root.appendChild(sectionHead('Same-site clusters',
    clusters.length ? badge(`${clusters.length} site${clusters.length === 1 ? '' : 's'}`, 'muted') : null
  ));

  if (!clusters.length) {
    root.appendChild(el('p', { class: 'section-sub', style: 'margin:-6px 0 12px', text: 'No site has 3+ tabs open. When several tabs come from one site (like multiple watch pages), they appear here so you can group or trim them.' }));
    return;
  }
  root.appendChild(el('p', { class: 'section-sub', style: 'margin:-6px 0 12px', text: 'These are DIFFERENT pages on the same site — maybe a series, maybe leftovers from a browse. Nothing closes automatically; group them for focus, or close the ones you are done with.' }));

  for (const cl of clusters.slice(0, 20)) {
    const c = card('suggest-card');
    c.appendChild(el('div', { class: 'suggest-head' },
      el('span', { class: 'group-dot', style: 'background:#8e9297' }),
      el('span', { class: 'suggest-name', title: cl.host, text: cl.host }),
      el('span', { class: 'suggest-count', text: `${cl.count} tabs` })
    ));
    const list = el('div', { class: 'suggest-list' });
    for (const t of cl.tabs.slice(0, 12)) {
      list.appendChild(tabRow(t, {
        onOpen: (tab) => activateTab(tab.id),
        meta: shorten(t.url.replace(/^https?:\/\/[^/]+/, ''), 40)
      }));
    }
    if (cl.count > 12) list.appendChild(el('div', { class: 'tab-row', style: 'color:var(--text-faint);font-size:12.5px', text: `+ ${cl.count - 12} more` }));
    c.appendChild(list);
    c.appendChild(el('div', { class: 'suggest-foot' },
      el('span', { class: 'tab-host', text: 'Different pages from one site' }),
      el('button', {
        class: 'btn btn-secondary btn-sm', text: `Group all ${cl.count}`,
        onclick: async () => {
          try {
            const byWindow = new Map();
            for (const t of cl.tabs) {
              if (!byWindow.has(t.windowId)) byWindow.set(t.windowId, []);
              byWindow.get(t.windowId).push(t.id);
            }
            let grouped = 0;
            for (const [wid, ids] of byWindow) {
              try {
                const gid = await groupTabsInWindow(ids, wid);
                await applyGroupMeta(gid, { title: cl.host, color: 'cyan' });
                grouped += ids.length;
              } catch { /* skip window */ }
            }
            toast(`Grouped ${grouped} tabs under “${cl.host}”.`, { type: 'success' });
            await refreshTabs();
            ctx.rerender();
          } catch (e) {
            logError('same-site group', e);
            toast(friendly(e), { type: 'error' });
          }
        }
      })
    ));
    root.appendChild(c);
  }
  if (clusters.length > 20) {
    root.appendChild(el('p', { class: 'section-sub', text: `+ ${clusters.length - 20} more sites` }));
  }
}

function shorten(s, n) {
  s = s.replace(/^https?:\/\//, '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

/* --------------------------------- stale ---------------------------------- */

const staleSelected = new Set();

function renderStale(root, ctx) {
  root.appendChild(sectionHead('Possibly stale',
    store.stale && store.stale.stale.length ? badge(`${store.stale.stale.length} tabs`, 'warn') : null
  ));

  if (store.stale && store.stale.capabilityMissing) {
    root.appendChild(el('div', { class: 'notice' },
      el('span', { class: 'notice-icon' }),
      el('div', { class: 'notice-body' },
        el('div', { class: 'notice-title', text: 'Chrome is not reporting access times for some tabs' }),
        el('div', { class: 'notice-sub', text: 'Those tabs are skipped. Fully updating Chrome usually fixes this.' })
      )
    ));
  }

  if (!store.stale || !store.stale.stale.length) {
    root.appendChild(emptyState({
      iconName: 'clock',
      title: 'No stale tabs',
      text: `Nothing has sat untouched for more than ${store.settings?.staleDays ?? 7} days. Adjust the threshold in Settings.`
    }));
    return;
  }

  const stale = store.stale.stale;
  root.appendChild(el('p', { class: 'section-sub', style: 'margin:-6px 0 12px', text: 'Not accessed recently. Review, close, save as a workspace, or move them to a Read Later group.' }));

  const select = el('select', { class: 'input', style: 'width:auto', 'aria-label': 'Stale threshold' },
    [1, 3, 7, 14, 30].map((d) => el('option', { value: String(d), text: `Unused for ${d} day${d === 1 ? '' : 's'}`, selected: d === store.settings.staleDays }))
  );
  select.addEventListener('change', async () => {
    const days = Number(select.value);
    const { updateSettings } = await import('../store.js');
    await updateSettings({ staleDays: days });
    ctx.rerender();
  });

  const list = card('tab-list');
  for (const t of stale.slice(0, 100)) {
    list.appendChild(tabRow(t, {
      selectable: true,
      selected: staleSelected.has(t.id),
      onToggle: (id, on) => { on ? staleSelected.add(id) : staleSelected.delete(id); },
      onOpen: (tab) => activateTab(tab.id),
      meta: rel(t.lastAccessed)
    }));
  }
  root.appendChild(list);

  const ids = () => [...staleSelected].filter((id) => stale.some((t) => t.id === id));

  root.appendChild(el('div', { class: 'btn-row', style: 'margin-top:12px' },
    select,
    el('span', { class: 'tab-host', text: `${staleSelected.size || stale.length} selected` }),
    el('button', { class: 'btn btn-ghost btn-sm', text: 'Select all', onclick: () => { staleSelected.clear(); for (const t of stale) staleSelected.add(t.id); ctx.rerender(); } }),
    el('button', {
      class: 'btn btn-danger btn-sm', text: 'Close selected',
      onclick: async () => {
        const targets = staleSelected.size ? ids() : stale.map((t) => t.id);
        const res = await closeTabsWithProtection(targets, {
          title: `Close ${targets.length} stale tab${targets.length === 1 ? '' : 's'}?`,
          message: 'A snapshot is saved first, so they can be restored from History.'
        });
        if (res != null) { staleSelected.clear(); await refreshTabs(); ctx.rerender(); }
      }
    }),
    el('button', {
      class: 'btn btn-secondary btn-sm', text: 'Save selected as workspace',
      onclick: async () => {
        const targets = staleSelected.size ? ids() : stale;
        const name = await promptDialog({
          title: 'Save stale tabs first',
          label: 'Workspace name',
          value: `Read later ${new Date().toISOString().slice(0, 10)}`,
          confirmLabel: 'Save workspace'
        });
        if (!name) return;
        try {
          const ws = await createWorkspace(name, targets);
          toast(`Saved ${ws.tabs.length} tabs to “${ws.name}”. Closing nothing yet.`, { type: 'success' });
          ctx.rerender();
        } catch (e) {
          logError('save stale', e);
          toast(friendly(e), { type: 'error' });
        }
      }
    }),
    el('button', {
      class: 'btn btn-secondary btn-sm', text: 'Move to “Read Later” group',
      onclick: async () => {
        const targets = staleSelected.size ? ids() : stale.map((t) => t.id);
        try {
          const byWindow = new Map();
          for (const id of targets) {
            const t = store.tabs.find((x) => x.id === id);
            if (!t) continue;
            if (!byWindow.has(t.windowId)) byWindow.set(t.windowId, []);
            byWindow.get(t.windowId).push(id);
          }
          let grouped = 0;
          for (const [wid, list] of byWindow) {
            try {
              const gid = await groupTabsInWindow(list, wid);
              await applyGroupMeta(gid, { title: 'Read Later', color: 'cyan' });
              grouped += list.length;
            } catch { /* skip window */ }
          }
          staleSelected.clear();
          toast(`Moved ${grouped} tabs into a “Read Later” group.`, { type: 'success' });
          await refreshTabs();
          ctx.rerender();
        } catch (e) {
          logError('read later', e);
          toast(friendly(e), { type: 'error' });
        }
      }
    })
  ));
}

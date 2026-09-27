// History — snapshots, preview and restore (the safety net, visible).

import {
  el, card, sectionHead, emptyState, toast, badge, rel, confirmDialog, openModal
} from '../components.js';
import { store, refreshSnapshots, saveSnapshotNow } from '../store.js';
import { deleteSnapshot, restoreSnapshot } from '../../core/snapshots.js';
import { friendly, logError } from '../../core/errors.js';
import { hostOf, timeOfDay, dayLabel } from '../../shared/utils.js';

export async function render(root, ctx) {
  root.appendChild(sectionHead('History',
    el('button', {
      class: 'btn btn-secondary btn-sm', text: 'Save snapshot now',
      onclick: async () => {
        try {
          const snap = await saveSnapshotNow();
          toast(`Snapshot created — ${snap.counts.tabs} tabs · ${snap.counts.windows} windows.`, { type: 'success' });
        } catch (e) {
          toast(friendly(e), { type: 'error', timeout: 9000 });
        }
      }
    }),
    el('button', { class: 'btn btn-ghost btn-sm', text: 'Snapshot settings', onclick: () => ctx.navigate('settings') })
  ));
  root.appendChild(el('p', { class: 'section-sub', style: 'margin:-6px 0 16px', text: 'Snapshots are taken automatically before TabVault organizes anything. Restoring never deletes your current tabs unless you explicitly ask.' }));

  if (!store.snapshots.length) {
    root.appendChild(emptyState({
      iconName: 'camera',
      title: 'No snapshots yet',
      text: 'TabVault saves a snapshot of your windows and tabs before every organization.'
    }));
    return;
  }

  const byDay = new Map();
  for (const snap of store.snapshots) {
    const key = dayLabel(snap.createdAt);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(snap);
  }

  for (const [day, snaps] of byDay) {
    const dayWrap = el('div', { class: 'history-day' });
    dayWrap.appendChild(el('div', { class: 'history-day-label', text: day }));
    const c = card();
    for (const snap of snaps) c.appendChild(snapshotRow(snap, ctx));
    dayWrap.appendChild(c);
    root.appendChild(dayWrap);
  }
}

function snapshotRow(snap, ctx) {
  const triggerBadge = {
    'pre-organize': badge('before organizing', 'accent'),
    'pre-stash': badge('before stash', 'accent'),
    'pre-close': badge('before closing', 'warn'),
    auto: badge('auto', 'muted'),
    manual: badge('manual', 'muted'),
    install: badge('first run', 'muted'),
    imported: badge('restored', 'muted')
  }[snap.trigger] || badge('snapshot', 'muted');

  return el('div', { class: 'history-row' },
    el('span', { class: 'history-time', text: timeOfDay(snap.createdAt) }),
    el('div', { class: 'history-info' },
      el('div', { class: 'history-counts', text: `${snap.counts.tabs} tabs · ${snap.counts.windows} windows` }),
      el('div', { class: 'history-trigger' }, el('span', { text: `${rel(snap.createdAt)} · ` }), triggerBadge)
    ),
    el('button', { class: 'btn btn-secondary btn-sm', text: 'Preview', onclick: () => previewSnapshot(snap) }),
    el('button', { class: 'btn btn-primary btn-sm', text: 'Restore', onclick: () => confirmRestore(snap, ctx) }),
    el('button', {
      class: 'icon-btn', 'aria-label': 'Delete snapshot', html: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13a1 1 0 001 1h8a1 1 0 001-1l1-13M9 7V4h6v3"/></svg>',
      onclick: async () => {
        const { ok } = await confirmDialog({
          title: 'Delete this snapshot?',
          message: 'Your tabs are not affected — this only removes the restore point.',
          confirmLabel: 'Delete snapshot', danger: true
        });
        if (!ok) return;
        await deleteSnapshot(snap.id);
        await refreshSnapshots();
        ctx.rerender();
      }
    })
  );
}

function previewSnapshot(snap) {
  const body = el('div', {});
  let shown = 0;
  let m; // assigned right after openModal — safe because clicks happen later
  for (const w of snap.windows) {
    const list = el('div', { class: 'modal-list', style: 'padding:4px;margin-bottom:12px;max-height:200px' });
    const rows = w.tabs.slice(0, 50);
    for (const t of rows) {
      list.appendChild(el('div', { class: 'tab-row' },
        el('span', { class: 'tab-main' },
          el('span', { class: 'tab-title', text: t.title || t.url || 'Untitled' }),
          el('span', { class: 'tab-host', text: hostOf(t.url) })
        ),
        t.pinned ? badge('Pinned', 'muted') : null
      ));
    }
    if (w.tabs.length > rows.length) {
      list.appendChild(el('div', { class: 'tab-row', style: 'color:var(--text-faint)', text: `+ ${w.tabs.length - rows.length} more` }));
    }
    body.appendChild(el('div', { class: 'field-label', text: `Window — ${w.tabs.length} tabs${w.state === 'maximized' ? ' (maximized)' : ''}` }));
    body.appendChild(list);
    shown += w.tabs.length;
    if (shown > 300) { body.appendChild(el('p', { class: 'modal-text', text: '…' })); break; }
  }
  m = openModal({
    title: `Snapshot — ${snap.counts.tabs} tabs · ${snap.counts.windows} windows`,
    body,
    wide: true,
    footer: el('div', { class: 'btn-row end' }, el('button', { class: 'btn btn-primary', text: 'Close', 'data-autofocus': true, onclick: () => m.close() }))
  });
}

async function confirmRestore(snap, ctx) {
  const { ok, checked } = await confirmDialog({
    title: 'Restore this snapshot?',
    message: `TabVault will open the ${snap.counts.tabs} tabs from this snapshot in their windows. Tabs that are already open are reused, never duplicated — and nothing you have open now is closed.`,
    checkbox: 'Also close tabs that are not part of this snapshot (you can undo via a newer snapshot)',
    confirmLabel: 'Restore snapshot'
  });
  if (!ok) return;
  try {
    const res = await restoreSnapshot(snap, { closeExtraneous: checked });
    const parts = [`Opened ${res.opened} tab${res.opened === 1 ? '' : 's'}`, `${res.windowsCreated} window${res.windowsCreated === 1 ? '' : 's'}`, `reused ${res.reused}`];
    if (checked) parts.push(`closed ${res.closed}`);
    toast(`Restore complete — ${parts.join(', ')}.`, { type: 'success', timeout: 8000 });
    ctx.rerender();
  } catch (e) {
    logError('restore', e);
    toast(friendly(e), { type: 'error', timeout: 9000 });
  }
}

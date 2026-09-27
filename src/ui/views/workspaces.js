// Workspaces — save and re-open collections of tabs.

import {
  el, card, sectionHead, emptyState, toast, faviconEl, menuBtn, confirmDialog, promptDialog, downloadText, rel, openModal
} from '../components.js';
import { store, refreshWorkspaces } from '../store.js';
import { createWorkspace, renameWorkspace, deleteWorkspace, openWorkspace } from '../../core/workspaces.js';
import { workspaceExport } from '../../core/backup.js';
import { friendly, logError } from '../../core/errors.js';
import { tabDescriptor } from '../../core/tabs.js';
import { GROUP_COLOR_HEX } from '../../shared/constants.js';

export async function render(root, ctx) {
  root.appendChild(sectionHead('Saved Workspaces',
    el('button', { class: 'btn btn-secondary btn-sm', text: 'Save current window', onclick: () => saveCurrent(ctx, 'window') }),
    el('button', { class: 'btn btn-secondary btn-sm', text: 'Save all tabs', onclick: () => saveCurrent(ctx, 'all') })
  ));
  root.appendChild(el('p', { class: 'section-sub', style: 'margin:-6px 0 16px', text: 'A workspace is a named set of tabs you can reopen any time — a project, a trip, a weekly routine.' }));

  if (!store.workspaces.length) {
    root.appendChild(emptyState({
      iconName: 'folder',
      title: 'No workspaces yet',
      text: 'Save a set of tabs you usually open together — then reopen them in one click as a window or a tab group.'
    }));
    return;
  }

  const grid = el('div', { class: 'ws-grid' });
  for (const ws of store.workspaces) grid.appendChild(wsCard(ws, ctx));
  root.appendChild(grid);
}

function wsCard(ws, ctx) {
  const c = card('ws-card');
  c.appendChild(el('div', { class: 'ws-title-row' },
    el('span', { class: 'group-dot', style: `background:${GROUP_COLOR_HEX[ws.color] || '#4d8ef7'}` }),
    el('span', { class: 'ws-name', title: ws.name, text: ws.name }),
    menuBtn({
      ariaLabel: `Workspace options for ${ws.name}`,
      items: [
        { label: 'Rename', value: 'rename' },
        { label: 'Export as JSON', value: 'exp:json' },
        { label: 'Export as Markdown', value: 'exp:md' },
        { label: 'Export as HTML', value: 'exp:html' },
        { label: 'Export as TXT', value: 'exp:txt' },
        { separator: true },
        { label: 'Delete', value: 'delete', danger: true }
      ],
      onPick: (v) => handleAction(v, ws, ctx)
    })
  ));
  c.appendChild(el('div', { class: 'ws-meta', text: `${ws.tabs.length} tab${ws.tabs.length === 1 ? '' : 's'} · saved ${rel(ws.createdAt)}` }));
  c.appendChild(el('div', { class: 'ws-preview', text: ws.tabs.slice(0, 3).map((t) => t.title || t.url).join(' · ') || '—' }));
  c.appendChild(el('div', { class: 'btn-row', style: 'margin-top:auto' },
    el('button', { class: 'btn btn-primary btn-sm', text: 'Open Workspace', onclick: () => chooseOpenTarget(ws, ctx) })
  ));
  return c;
}

async function handleAction(v, ws, ctx) {
  try {
    if (v === 'rename') {
      const name = await promptDialog({ title: 'Rename workspace', label: 'Workspace name', value: ws.name });
      if (name) { await renameWorkspace(ws.id, name); await refreshWorkspaces(); }
    } else if (v.startsWith('exp:')) {
      const fmt = v.slice(4);
      const out = workspaceExport(ws, fmt);
      downloadText(out.filename, out.mime, out.content);
      toast(`Exported “${ws.name}” as ${fmt.toUpperCase()}.`, { type: 'success', timeout: 3500 });
    } else if (v === 'delete') {
      const { ok } = await confirmDialog({
        title: `Delete “${ws.name}”?`,
        message: `The workspace with ${ws.tabs.length} tabs will be removed from TabVault. Open browser tabs are not affected.`,
        confirmLabel: 'Delete workspace', danger: true
      });
      if (!ok) return;
      await deleteWorkspace(ws.id);
      await refreshWorkspaces();
      toast('Workspace deleted.', { timeout: 3000 });
    }
  } catch (e) {
    logError('workspace action', e);
    toast(friendly(e), { type: 'error' });
  }
}

async function chooseOpenTarget(ws, ctx) {
  let settled = false;
  let resolveFn;
  const promise = new Promise((r) => { resolveFn = r; });
  const body = el('div', { class: 'modal-list', style: 'padding:6px' });
  const options = [
    { value: 'window', label: 'New window', desc: `${ws.tabs.length} tabs in a fresh window` },
    { value: 'current', label: 'Current window', desc: 'Added at the end of this window' },
    { value: 'group', label: 'New tab group', desc: 'Opened here and grouped together' }
  ];
  for (const o of options) {
    body.appendChild(el('button', {
      class: 'menu-item', style: 'width:100%',
      onclick: () => { settled = true; resolveFn(o.value); m.close(); }
    },
      el('span', { class: 'tab-title', text: o.label, style: 'display:block' }),
      el('span', { class: 'tab-host', text: o.desc, style: 'display:block' })
    ));
  }
  const m = openModal({
    title: `Open “${ws.name}”`,
    body,
    footer: el('div', { class: 'btn-row end' }, el('button', { class: 'btn btn-secondary', text: 'Cancel', onclick: () => { settled = true; resolveFn(null); m.close(); } })),
    onClose: () => { if (!settled) resolveFn(null); }
  });
  const target = await promise;
  if (!target) return;
  try {
    const res = await openWorkspace(ws, target);
    toast(`Opened ${res.opened} tab${res.opened === 1 ? '' : 's'} from “${ws.name}”.`, { type: 'success' });
  } catch (e) {
    logError('open workspace', e);
    toast(friendly(e), { type: 'error' });
  }
}

async function saveCurrent(ctx, source) {
  const currentWinId = source === 'window' ? await currentWindowId() : null;
  const tabs = source === 'window'
    ? store.tabs.filter((t) => t.windowId === currentWinId)
    : store.tabs;
  if (!tabs.length) {
    toast(source === 'window' ? 'The current window has no tabs to save.' : 'No tabs to save.');
    return;
  }
  const name = await promptDialog({
    title: source === 'window' ? 'Save current window' : 'Save all tabs',
    label: 'Workspace name',
    placeholder: 'e.g. Work project',
    confirmLabel: 'Save workspace'
  });
  if (!name) return;
  try {
    const ws = await createWorkspace(name, tabs.map(tabDescriptor), { source });
    await refreshWorkspaces();
    toast(
      ws.duplicatesRemoved > 0
        ? `Workspace saved with ${ws.tabs.length} tabs (${ws.duplicatesRemoved} duplicate${ws.duplicatesRemoved === 1 ? '' : 's'} skipped).`
        : `Workspace “${ws.name}” saved with ${ws.tabs.length} tab${ws.tabs.length === 1 ? '' : 's'}.`,
      { type: 'success' }
    );
  } catch (e) {
    logError('save workspace', e);
    toast(friendly(e), { type: 'error' });
  }
}

async function currentWindowId() {
  try {
    const w = await chrome.windows.getLastFocused();
    return w?.id ?? null;
  } catch {
    return null;
  }
}

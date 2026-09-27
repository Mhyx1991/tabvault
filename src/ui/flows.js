// Shared user flows with built-in safety rails:
//  - every destructive action shows a review step (unless the user turned it
//    off in Settings) and takes a snapshot first
//  - failures are reported in friendly language, never raw stack traces

import { el, confirmDialog, toast } from './components.js';
import { store, applyGroups, undoOrganize } from './store.js';
import { friendly } from '../core/errors.js';
import { closeTabsSafe } from '../core/tabs.js';
import { createSnapshot } from '../core/snapshots.js';

/** Confirm (per settings) + organize. Returns the result or null when cancelled/failed. */
export async function confirmAndOrganize(groups, { title = 'Organize your tabs?' } = {}) {
  if (!groups.length) {
    toast('Your tabs already look organized.');
    return null;
  }
  if (store.settings.confirmBeforeOrganize) {
    const totalTabs = groups.reduce((n, g) => n + g.tabIds.length, 0);
    const list = el('div', { class: 'modal-list', style: 'padding:6px' },
      groups.map((g) => el('div', { class: 'tab-row' },
        el('span', { class: 'suggest-emoji', text: g.emoji || '📁' }),
        el('span', { class: 'tab-main' },
          el('span', { class: 'tab-title', text: g.name }),
          el('span', { class: 'tab-host', text: `${g.tabIds.length} tab${g.tabIds.length === 1 ? '' : 's'}` })
        )
      ))
    );
    const { ok } = await confirmDialog({
      title,
      message: `TabVault will group ${totalTabs} tab${totalTabs === 1 ? '' : 's'} into ${groups.length} group${groups.length === 1 ? '' : 's'} using Chrome's native tab groups. A snapshot is saved first, so you can undo everything.`,
      html: list,
      confirmLabel: 'Organize My Tabs',
      cancelLabel: 'Cancel'
    });
    if (!ok) return null;
  }
  try {
    const result = await applyGroups(groups);
    reportOrganizeResult(result);
    return result;
  } catch (e) {
    toast(friendly(e), { type: 'error', timeout: 9000 });
    return null;
  }
}

export function reportOrganizeResult(result) {
  if (!result) return;
  const groupCount = new Set((result.applied || []).map((a) => a.name)).size;
  if (result.failed?.length) {
    toast(`Organized ${result.tabsGrouped} tabs. ${result.failed.length} group${result.failed.length === 1 ? '' : 's'} could not be created — nothing was lost.`, { type: 'error', timeout: 9000 });
  } else {
    toast(`Organized ${result.tabsGrouped} tabs into ${groupCount} group${groupCount === 1 ? '' : 's'}. Snapshot saved.`, {
      type: 'success',
      actionLabel: 'Undo',
      timeout: 10000,
      onAction: async () => {
        try {
          await undoOrganize();
          toast('Previous layout restored.');
        } catch (e) {
          toast(friendly(e), { type: 'error' });
        }
      }
    });
  }
}

/**
 * Close tabs with snapshot + (configurable) confirmation.
 * Returns the number closed, or null when cancelled.
 */
export async function closeTabsWithProtection(tabIds, { title = 'Close tabs?', message } = {}) {
  const ids = [...new Set(tabIds)].filter((id) => id != null);
  if (!ids.length) return 0;

  if (store.settings.confirmBeforeClose) {
    const { ok } = await confirmDialog({
      title,
      message: message || `This will close ${ids.length} tab${ids.length === 1 ? '' : 's'}. A snapshot is saved first so you can restore them from History.`,
      confirmLabel: `Close ${ids.length} tab${ids.length === 1 ? '' : 's'}`,
      cancelLabel: 'Keep tabs',
      danger: true
    });
    if (!ok) return null;
  }

  try {
    if (store.settings.autoSnapshot) await createSnapshot('pre-close');
  } catch (e) {
    toast(friendly(e), { type: 'error', timeout: 9000 });
    return null;
  }

  const res = await closeTabsSafe(ids);
  if (res.failed.length) {
    toast(`Closed ${res.closed} tab${res.closed === 1 ? '' : 's'}. ${res.failed.length} could not be closed (Chrome protects some pages).`, { type: 'error' });
  } else {
    toast(`Closed ${res.closed} tab${res.closed === 1 ? '' : 's'}. You can restore from History.`, { type: 'success', timeout: 5000 });
  }
  return res.closed;
}

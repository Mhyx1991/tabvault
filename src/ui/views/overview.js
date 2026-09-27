// Overview — the main dashboard view + first-run onboarding.

import {
  el, clear, icon, card, sectionHead, emptyState, toast, rel
} from '../components.js';
import { store, ensureAnalysis, dismissed, updateSettings, undoOrganize } from '../store.js';
import { buildGroupsFromSuggestions } from '../../core/organize.js';
import { confirmAndOrganize } from '../flows.js';
import { GROUP_COLOR_HEX } from '../../shared/constants.js';
import { friendly, logError } from '../../core/errors.js';

export async function render(root, ctx) {
  if (!store.settings.onboarded) {
    renderOnboarding(root, ctx);
    return;
  }

  await ctx.ensureAnalysis();
  const tabs = store.tabs;
  const a = store.analysis;

  /* hero */
  const heroCard = card();
  heroCard.className = 'card hero';
  heroCard.append(
    el('div', { class: 'hero-stat' },
      el('div', { class: 'hero-num', text: String(tabs.length) }),
      el('div', { class: 'hero-label', text: tabs.length === 1 ? 'Tab open' : 'Tabs open' })
    ),
    el('div', { class: 'hero-actions' },
      el('button', {
        class: 'btn btn-primary btn-lg', text: 'Organize My Tabs',
        onclick: () => organizeAll(ctx)
      }),
      el('div', { class: 'btn-row' },
        el('button', { class: 'btn btn-secondary', text: 'Review Suggestions', onclick: () => ctx.navigate('suggestions') }),
        el('button', { class: 'btn btn-secondary', text: 'Saved Workspaces', onclick: () => ctx.navigate('workspaces') }),
        el('button', { class: 'btn btn-secondary', text: 'History', onclick: () => ctx.navigate('history') })
      )
    )
  );
  root.appendChild(heroCard);

  /* stat strip */
  root.appendChild(el('div', { class: 'stat-strip' },
    statTile(store.windowsCount, store.windowsCount === 1 ? 'Window' : 'Windows'),
    statTile(a ? a.suggestions.length : 0, 'Suggested groups'),
    statTile(store.meta.lastOrganize ? rel(store.meta.lastOrganize.at) : 'Never', 'Last organized'),
    statTile(store.settings.autoSnapshot ? `On · ${rel(store.meta.lastSnapshotAt)}` : 'Off', 'Auto-snapshot')
  ));

  /* undo banner */
  if (store.meta.lastOrganize) {
    const lo = store.meta.lastOrganize;
    root.appendChild(el('div', { class: 'notice notice-undo' },
      el('span', { class: 'notice-icon', html: icon('undo', 18) }),
      el('div', { class: 'notice-body' },
        el('div', { class: 'notice-title', text: `Last organization: ${lo.tabsGrouped} tabs into ${lo.groups} groups` }),
        el('div', { class: 'notice-sub', text: `${rel(lo.at)} · one click restores the previous layout` })
      ),
      el('button', {
        class: 'btn btn-secondary btn-sm', text: 'Undo',
        onclick: async () => {
          try {
            await undoOrganize();
            toast('Previous layout restored.', { type: 'success' });
          } catch (e) {
            toast(friendly(e), { type: 'error' });
          }
        }
      })
    ));
  }

  /* attention */
  if (store.dupTabCount > 0) {
    root.appendChild(el('div', { class: 'notice notice-warn' },
      el('span', { class: 'notice-icon', html: icon('copy', 18) }),
      el('div', { class: 'notice-body' },
        el('div', { class: 'notice-title', text: `Possible duplicates — ${store.dupTabCount} extra copies` }),
        el('div', { class: 'notice-sub', text: `${store.duplicates.length} page${store.duplicates.length === 1 ? '' : 's'} open more than once` })
      ),
      el('button', { class: 'btn btn-secondary btn-sm', text: 'Review', onclick: () => ctx.navigate('care') })
    ));
  }
  if (store.stale && store.stale.stale.length > 0) {
    root.appendChild(el('div', { class: 'notice notice-warn' },
      el('span', { class: 'notice-icon', html: icon('clock', 18) }),
      el('div', { class: 'notice-body' },
        el('div', { class: 'notice-title', text: `Possibly stale — ${store.stale.stale.length} tabs` }),
        el('div', { class: 'notice-sub', text: `Not accessed in the last ${store.settings.staleDays} days` })
      ),
      el('button', { class: 'btn btn-secondary btn-sm', text: 'Review', onclick: () => ctx.navigate('care') })
    ));
  }

  /* suggestions preview */
  if (!tabs.length) {
    root.appendChild(sectionHead('Suggestions'));
    root.appendChild(emptyState({
      iconName: 'check',
      title: "You're all clear. No tabs to organize.",
      text: 'Open a few pages and TabVault will suggest a tidy structure.'
    }));
  } else if (dismissed() || !a || !a.suggestions.length) {
    root.appendChild(sectionHead('Suggestions'));
    root.appendChild(emptyState({
      iconName: 'check',
      title: 'Your tabs already look organized.',
      text: dismissed() ? 'Suggestions were dismissed for this set of tabs. Re-analyze any time.' : 'Nothing new to suggest right now.',
      actions: [el('button', { class: 'btn btn-secondary', text: 'Re-analyze', onclick: () => ctx.navigate('suggestions') })]
    }));
  } else {
    root.appendChild(sectionHead('Suggested organization',
      el('button', { class: 'btn btn-ghost btn-sm', text: 'Review all', onclick: () => ctx.navigate('suggestions') })
    ));
    const grid = el('div', { class: 'suggest-grid' });
    for (const s of a.suggestions.slice(0, 3)) grid.appendChild(suggestPreviewCard(s, ctx));
    root.appendChild(grid);
    if (a.suggestions.length > 3) {
      root.appendChild(el('div', { class: 'btn-row center', style: 'margin-top:12px' },
        el('button', { class: 'btn btn-secondary', text: `Review all ${a.suggestions.length} groups`, onclick: () => ctx.navigate('suggestions') })
      ));
    }
  }

  /* recent history preview */
  if (store.snapshots.length) {
    root.appendChild(sectionHead('Recent snapshots',
      el('button', { class: 'btn btn-ghost btn-sm', text: 'View history', onclick: () => ctx.navigate('history') })
    ));
    const c = card();
    for (const snap of store.snapshots.slice(0, 3)) {
      c.appendChild(el('div', { class: 'history-row' },
        el('span', { class: 'history-time', text: rel(snap.createdAt) }),
        el('div', { class: 'history-info' },
          el('div', { class: 'history-counts', text: `${snap.counts.tabs} tabs · ${snap.counts.windows} windows` }),
          el('div', { class: 'history-trigger', text: triggerLabel(snap.trigger) })
        )
      ));
    }
    root.appendChild(c);
  }
}

function statTile(num, label) {
  const t = card('stat-tile');
  t.append(
    el('div', { class: 'stat-num', text: String(num) }),
    el('div', { class: 'stat-label', text: label })
  );
  return t;
}

function suggestPreviewCard(s, ctx) {
  const c = card('suggest-card');
  c.append(
    el('div', { class: 'suggest-head' },
      el('span', { class: 'suggest-emoji', text: s.emoji }),
      el('span', { class: 'suggest-name', text: s.name }),
      el('span', { class: 'suggest-count', text: `${s.tabs.length} tab${s.tabs.length === 1 ? '' : 's'}` })
    ),
    el('div', { class: 'suggest-list' },
      s.tabs.slice(0, 4).map((t) => el('div', { class: 'tab-row' },
        el('span', { class: 'group-dot', style: `background:${GROUP_COLOR_HEX[s.color] || '#8e9297'}` }),
        el('span', { class: 'tab-main' },
          el('span', { class: 'tab-title', text: t.title || t.url }),
          el('span', { class: 'tab-host', text: t.host })
        )
      )),
      s.tabs.length > 4 ? el('div', { class: 'tab-row', style: 'color:var(--text-faint);font-size:12.5px', text: `+ ${s.tabs.length - 4} more` }) : null
    ),
    el('div', { class: 'suggest-foot' },
      el('button', { class: 'btn btn-secondary btn-sm', text: 'Review', onclick: () => ctx.navigate('suggestions') }),
      el('button', {
        class: 'btn btn-primary btn-sm', text: 'Apply',
        onclick: () => confirmAndOrganize(buildGroupsFromSuggestions([s]), { title: `Create “${s.name}”?` })
      })
    )
  );
  return c;
}

async function organizeAll(ctx) {
  const a = await ctx.ensureAnalysis(true);
  if (!a || !a.suggestions.length || dismissed()) {
    toast('Your tabs already look organized.');
    ctx.navigate('suggestions');
    return;
  }
  const groups = buildGroupsFromSuggestions(a.suggestions);
  await confirmAndOrganize(groups);
  ctx.rerender();
}

function triggerLabel(t) {
  return {
    install: 'First snapshot',
    auto: 'Automatic snapshot',
    manual: 'Manual snapshot',
    'pre-organize': 'Before organizing',
    'pre-stash': 'Before stashing tabs',
    'pre-close': 'Before closing tabs',
    imported: 'Restored from backup'
  }[t] || 'Snapshot';
}

/* ------------------------------- onboarding ------------------------------- */

function renderOnboarding(root, ctx) {
  let stage = 'start';
  let analysis = null;

  const wrap = el('div', {});
  const cardEl = card('onboard');

  function draw() {
    clear(cardEl);
    if (stage === 'start') {
      cardEl.append(
        el('div', { class: 'onboard-num', text: String(store.tabs.length) }),
        el('h1', { class: 'onboard-title', text: `You have ${store.tabs.length} tab${store.tabs.length === 1 ? '' : 's'}.` }),
        el('p', { class: 'onboard-sub', text: "Let's organize them. TabVault suggests groups, and everything is undoable — nothing is ever lost." }),
        el('div', { class: 'onboard-actions' },
          el('button', {
            class: 'btn btn-primary btn-lg', text: 'Analyze My Tabs',
            onclick: async () => {
              analysis = await ensureAnalysis(true);
              stage = 'result';
              draw();
            }
          })
        ),
        el('div', { class: 'onboard-skip' },
          el('button', { class: 'btn btn-ghost btn-sm', text: 'Skip for now', onclick: finish })
        )
      );
    } else if (stage === 'result') {
      const count = analysis?.suggestions.length || 0;
      cardEl.append(
        el('h1', { class: 'onboard-title', text: count ? `We found ${count} possible group${count === 1 ? '' : 's'}.` : 'Your tabs already look organized.' }),
        ...(count ? [el('p', { class: 'onboard-sub', text: `Review the suggestions, then organize. ${analysis.unsorted.tabs.length} tab${analysis.unsorted.tabs.length === 1 ? '' : 's'} need no decision yet.` })] : []),
        ...(count ? [el('div', { class: 'onboard-chips' },
          analysis.suggestions.map((s) => el('span', { class: 'onboard-chip' },
            el('span', { text: s.emoji }),
            el('span', { text: `${s.name} · ${s.tabs.length}` })
          ))
        )] : []),
        el('div', { class: 'onboard-actions' },
          count ? el('button', { class: 'btn btn-secondary', text: 'Review Organization', onclick: async () => { await finish(false); ctx.navigate('suggestions'); } }) : null,
          count ? el('button', {
            class: 'btn btn-primary btn-lg', text: 'Organize My Tabs',
            onclick: async () => {
              const groups = buildGroupsFromSuggestions(analysis.suggestions);
              const result = await confirmAndOrganize(groups, { title: 'Organize your tabs?' });
              if (result) { await finish(false); ctx.rerender(); }
            }
          }) : el('button', { class: 'btn btn-primary btn-lg', text: 'Go to Overview', onclick: () => finish(false) })
        ),
        el('div', { class: 'onboard-skip' },
          el('button', { class: 'btn btn-ghost btn-sm', text: 'Back', onclick: () => { stage = 'start'; draw(); } })
        )
      );
    }
  }

  async function finish(notify = true) {
    try {
      await updateSettings({ onboarded: true });
    } catch (e) {
      logError('onboarding finish', e);
    }
    ctx.rerender();
  }

  wrap.appendChild(cardEl);
  root.appendChild(wrap);
  draw();
}

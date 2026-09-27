// Settings — organization, safety, appearance, rules, and data management.

import {
  el, card, sectionHead, toast, confirmDialog, downloadText, badge, emptyState
} from '../components.js';
import { store, updateSettings, refreshData } from '../store.js';
import { CATEGORIES } from '../../shared/constants.js';
import { buildBackup, validateBackup, importBackup } from '../../core/backup.js';
import { friendly, logError } from '../../core/errors.js';

export async function render(root, ctx) {
  organizationSection(root, ctx);
  safetySection(root, ctx);
  memorySection(root, ctx);
  syncSection(root, ctx);
  appearanceSection(root, ctx);
  rulesSection(root, ctx);
  dataSection(root, ctx);
}

/* ------------------------------ organization ------------------------------ */

function organizationSection(root, ctx) {
  const s = store.settings;
  root.appendChild(sectionHead('Organization'));
  const c = card('card-pad settings-section');

  c.appendChild(switchRow({
    name: 'Automatically suggest groups',
    desc: 'Analyze open tabs and propose Chrome tab groups.',
    checked: s.autoSuggest,
    onChange: async (v) => { await updateSettings({ autoSuggest: v }); }
  }));

  c.appendChild(switchRow({
    name: 'Auto-group new tabs',
    desc: 'File tabs into the right group the moment you open them — same engine as manual organize, respects your domain rules and minimum confidence. Tabs you group yourself are never touched.',
    checked: s.autoGroup,
    onChange: async (v) => { await updateSettings({ autoGroup: v }); }
  }));

  c.appendChild(switchRow({
    name: 'Preserve existing groups',
    desc: "Leave tabs that are already in a Chrome group exactly where they are.",
    checked: s.preserveExistingGroups,
    onChange: async (v) => { await updateSettings({ preserveExistingGroups: v }); }
  }));

  c.appendChild(selectRow({
    name: 'Minimum confidence',
    desc: 'How sure TabVault must be before suggesting a group.',
    value: s.minConfidence,
    options: [
      { value: 'low', label: 'Low — suggest more groups' },
      { value: 'medium', label: 'Medium — balanced (recommended)' },
      { value: 'high', label: 'High — only very confident matches' }
    ],
    onChange: async (v) => { await updateSettings({ minConfidence: v }); }
  }));

  c.appendChild(selectRow({
    name: 'Minimum tabs per group',
    desc: 'Smaller sets are left in Unsorted.',
    value: String(s.minGroupSize),
    options: [1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: `${n} tab${n === 1 ? '' : 's'}` })),
    onChange: async (v) => { await updateSettings({ minGroupSize: Number(v) }); }
  }));

  /* preferred category names + icons + visibility (collapsible — with an
   * obvious affordance so people know it expands) */
  const collapsed = store.uiState?.catsCollapsed ?? true;
  const nameWrap = el('div', { class: 'field' });
  const toggleHead = el('button', {
    class: 'collapse-head',
    'aria-expanded': String(!collapsed),
    onclick: () => {
      store.uiState = { ...(store.uiState || {}), catsCollapsed: !collapsed };
      ctx.rerender();
    }
  },
    el('span', { class: 'collapse-chevron', html: collapsed ? '▸' : '▾' }),
    el('span', { class: 'field-label', style: 'margin:0', text: 'Categories — name, icon, visibility' }),
    el('span', { class: 'tab-host', style: 'margin-left:auto', text: collapsed ? 'Click to customize' : '' })
  );
  nameWrap.appendChild(toggleHead);
  if (!collapsed) {
    nameWrap.appendChild(el('p', { class: 'section-sub', style: 'margin:0 0 10px', text: 'Click the icon to change it. “Hide” removes a category from suggestions (its tabs become Unsorted); “Show” brings it back.' }));
  }
  const hidden = new Set(s.hiddenCategories || []);
  for (const cat of CATEGORIES) {
    if (collapsed) break;
    const isHidden = hidden.has(cat.id);
    const currentEmoji = (s.categoryEmojis || {})[cat.id] || cat.emoji;
    const input = el('input', {
      class: 'input', value: (s.categoryNames || {})[cat.id] || cat.name,
      'aria-label': `Name for ${cat.id}`, style: 'margin-bottom:6px',
      disabled: isHidden
    });
    input.addEventListener('change', async () => {
      const names = { ...(store.settings.categoryNames || {}) };
      if (input.value.trim() && input.value.trim() !== cat.name) names[cat.id] = input.value.trim();
      else delete names[cat.id];
      await updateSettings({ categoryNames: names });
    });

    // emoji picker button
    const emojiBtn = el('button', {
      class: 'suggest-emoji emoji-btn', text: currentEmoji,
      title: 'Change icon',
      'aria-label': `Change icon for ${cat.id}`,
      disabled: isHidden
    });
    emojiBtn.addEventListener('click', () => openEmojiPicker(emojiBtn, currentEmoji, async (emoji) => {
      const emojis = { ...(store.settings.categoryEmojis || {}) };
      if (emoji === cat.emoji) delete emojis[cat.id]; else emojis[cat.id] = emoji;
      await updateSettings({ categoryEmojis: emojis });
      emojiBtn.textContent = emoji;
    }));

    // hide/show toggle
    const hideBtn = el('button', {
      class: 'btn btn-ghost btn-sm', text: isHidden ? 'Show' : 'Hide',
      title: isHidden ? `Bring ${cat.name} back to suggestions` : `Remove ${cat.name} from suggestions`,
      'aria-label': `${isHidden ? 'Show' : 'Hide'} category ${cat.name}`
    });
    hideBtn.addEventListener('click', async () => {
      const next = new Set(store.settings.hiddenCategories || []);
      next.has(cat.id) ? next.delete(cat.id) : next.add(cat.id);
      await updateSettings({ hiddenCategories: [...next] });
      ctx.rerender();
    });

    nameWrap.appendChild(el('div', { class: 'rule-row' },
      emojiBtn,
      input,
      hideBtn
    ));
  }
  c.appendChild(nameWrap);
  root.appendChild(c);
}

/** Small inline emoji palette anchored under the clicked button. */
function openEmojiPicker(anchorBtn, current, onPick) {
  import('../../shared/constants.js').then(async ({ CATEGORY_EMOJIS }) => {
    document.querySelector('.emoji-pop')?.remove();
    const pop = el('div', { class: 'emoji-pop', role: 'menu', 'aria-label': 'Pick an icon' },
      el('div', { class: 'btn-row', style: 'flex-wrap:wrap;gap:2px' },
        CATEGORY_EMOJIS.map((e) => el('button', {
          class: 'emoji-opt' + (e === current ? ' selected' : ''), text: e,
          title: e,
          onclick: async () => { await onPick(e); pop.remove(); }
        }))
      )
    );
    document.body.appendChild(pop);
    const r = anchorBtn.getBoundingClientRect();
    pop.style.top = Math.min(window.innerHeight - 180, r.bottom + 6) + 'px';
    pop.style.left = Math.max(8, Math.min(window.innerWidth - 260, r.left)) + 'px';
    const close = (e) => { if (!pop.contains(e.target) && e.target !== anchorBtn) { pop.remove(); document.removeEventListener('click', close, true); } };
    setTimeout(() => document.addEventListener('click', close, true), 0);
  });
}

/* --------------------------------- safety --------------------------------- */

function safetySection(root, ctx) {
  const s = store.settings;
  root.appendChild(sectionHead('Safety'));
  const c = card('card-pad settings-section');

  c.appendChild(switchRow({
    name: 'Automatic snapshots',
    desc: 'Save a snapshot of all windows and tabs before TabVault changes anything — the basis of Undo.',
    checked: s.autoSnapshot,
    onChange: async (v) => { await updateSettings({ autoSnapshot: v }); }
  }));

  c.appendChild(selectRow({
    name: 'Snapshot frequency',
    desc: 'A periodic snapshot is also taken while the browser is running.',
    value: String(s.snapshotFrequencyHours),
    options: [6, 12, 24, 48, 72].map((h) => ({ value: String(h), label: `Every ${h} hours` })),
    onChange: async (v) => { await updateSettings({ snapshotFrequencyHours: Number(v) }); }
  }));

  c.appendChild(selectRow({
    name: 'Snapshot retention',
    desc: 'Older snapshots are removed automatically. Latest 3 are always kept.',
    value: String(s.snapshotRetention),
    options: [10, 30, 60, 100].map((n) => ({ value: String(n), label: `Keep ${n}` })),
    onChange: async (v) => { await updateSettings({ snapshotRetention: Number(v) }); }
  }));

  c.appendChild(switchRow({
    name: 'Confirm before closing tabs',
    desc: 'Show a review step whenever TabVault is about to close tabs (duplicates, stale tabs).',
    checked: s.confirmBeforeClose,
    onChange: async (v) => { await updateSettings({ confirmBeforeClose: v }); }
  }));

  c.appendChild(switchRow({
    name: 'Confirm before organizing',
    desc: 'Show a summary of the plan before applying it.',
    checked: s.confirmBeforeOrganize,
    onChange: async (v) => { await updateSettings({ confirmBeforeOrganize: v }); }
  }));

  c.appendChild(selectRow({
    name: 'Stale tab threshold',
    desc: 'How long a tab can sit untouched before it shows up under Duplicates & Stale.',
    value: String(s.staleDays),
    options: [1, 3, 7, 14, 30].map((d) => ({ value: String(d), label: `Unused for ${d} day${d === 1 ? '' : 's'}` })),
    onChange: async (v) => { await updateSettings({ staleDays: Number(v) }); }
  }));

  root.appendChild(c);
}

/* ------------------------------ memory & caps ------------------------------ */

function memorySection(root, ctx) {
  const s = store.settings;
  root.appendChild(sectionHead('Memory & limits'));
  const c = card('card-pad settings-section');

  c.appendChild(selectRow({
    name: 'Memory saver (discard idle tabs)',
    desc: 'Unloads tabs you have not touched for a while. The tab stays in the strip and reloads when clicked — nothing is lost, memory is freed. Checked at most once an hour.',
    value: String(s.discardAfterMinutes || 0),
    options: [
      { value: '0', label: 'Off' },
      { value: '20', label: 'After 20 minutes idle' },
      { value: '60', label: 'After 1 hour idle' },
      { value: '240', label: 'After 4 hours idle' },
      { value: '1440', label: 'After 1 day idle' }
    ],
    onChange: async (v) => { await updateSettings({ discardAfterMinutes: Number(v) }); }
  }));

  /* whitelist editor */
  const wlWrap = el('div', { class: 'field' });
  wlWrap.appendChild(el('div', { class: 'field-label', text: 'Never discard these sites' }));
  const wlInput = el('input', { class: 'input', placeholder: 'docs.google.com', 'aria-label': 'Add site to discard whitelist', style: 'margin-bottom:6px' });
  const wlAdd = el('button', {
    class: 'btn btn-secondary btn-sm', text: 'Add',
    onclick: async () => {
      const host = wlInput.value.trim().toLowerCase().replace(/^www\./, '');
      if (!host || !host.includes('.')) { toast('Enter a domain like “example.com”.'); return; }
      const list = [...new Set([...(store.settings.discardWhitelist || []), host])];
      await updateSettings({ discardWhitelist: list });
      wlInput.value = '';
      ctx.rerender();
    }
  });
  wlWrap.appendChild(el('div', { class: 'rule-row' }, wlInput, wlAdd));
  for (const host of s.discardWhitelist || []) {
    wlWrap.appendChild(el('div', { class: 'rule-row' },
      el('span', { class: 'tab-title', style: 'flex:1', text: host }),
      el('button', {
        class: 'icon-btn', 'aria-label': `Remove ${host} from whitelist`,
        html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
        onclick: async () => {
          const list = (store.settings.discardWhitelist || []).filter((h) => h !== host);
          await updateSettings({ discardWhitelist: list });
          ctx.rerender();
        }
      })
    ));
  }
  c.appendChild(wlWrap);

  c.appendChild(selectRow({
    name: 'Tab cap per window',
    desc: 'Shows a ⚠ count on the TabVault icon while any window is at or over the limit — a gentle nudge, nothing closes automatically.',
    value: String(s.tabCap || 0),
    options: [0, 10, 20, 30, 50].map((n) => ({ value: String(n), label: n ? `${n} tabs` : 'Off' })),
    onChange: async (v) => { await updateSettings({ tabCap: Number(v) }); }
  }));

  root.appendChild(c);
}

/* ------------------------------- sync ------------------------------------- */

function syncSection(root, ctx) {
  const s = store.settings;
  root.appendChild(sectionHead('Sync'));
  const c = card('card-pad settings-section');

  c.appendChild(switchRow({
    name: 'Sync settings across devices',
    desc: 'Syncs preferences only — theme, rules, thresholds — through your own Chrome profile. Never tabs, history or workspaces. Turn off any time to wipe the synced copy.',
    checked: s.syncEnabled,
    onChange: async (v) => {
      const { enableSync, disableSync } = await import('../../core/sync.js');
      if (v) {
        // Explicit opt-in confirmation (BUG-005): user acknowledges scope.
        const { confirmDialog } = await import('../components.js');
        const { ok } = await confirmDialog({
          title: 'Turn on settings sync?',
          message: 'Your preferences (theme, domain rules, thresholds, category names) will be stored in your Chrome profile and synced by Chrome to browsers where you are signed in.',
          html: el('p', { class: 'modal-text', text: 'Tabs, browsing history, snapshots and workspaces are NEVER synced and stay on this device.' }),
          confirmLabel: 'Enable sync'
        });
        if (!ok) return;
        await enableSync();
      } else {
        await disableSync();
      }
      await updateSettings({ syncEnabled: v, syncedAt: v ? Date.now() : 0 });
      toast(v ? 'Settings sync on — pushed to your Chrome profile.' : 'Settings sync off — synced copy removed.', { type: 'success' });
    }
  }));

  c.appendChild(el('div', { class: 'btn-row' },
    el('button', {
      class: 'btn btn-secondary btn-sm', text: 'Sync now',
      onclick: async () => {
        try {
          const { pushSettings } = await import('../../core/sync.js');
          await pushSettings();
          toast('Settings pushed to your Chrome profile.', { type: 'success', timeout: 3000 });
        } catch (e) {
          logError('sync now', e);
          toast(friendly(e), { type: 'error' });
        }
      }
    }),
    el('button', {
      class: 'btn btn-ghost btn-sm', text: 'Pull from cloud',
      onclick: async () => {
        try {
          const { pullSettings } = await import('../../core/sync.js');
          const res = await pullSettings({ force: true });
          toast(res.applied ? 'Settings pulled from your Chrome profile.' : 'Nothing to pull — cloud is empty.', { type: res.applied ? 'success' : 'info', timeout: 3000 });
          if (res.applied) { await refreshData(); ctx.rerender(); }
        } catch (e) {
          logError('sync pull', e);
          toast(friendly(e), { type: 'error' });
        }
      }
    })
  ));
  root.appendChild(c);
}

/* ------------------------------- appearance ------------------------------- */

function appearanceSection(root, ctx) {
  const s = store.settings;
  root.appendChild(sectionHead('Appearance'));
  const c = card('card-pad settings-section');
  c.appendChild(selectRow({
    name: 'Theme',
    desc: 'Follows your system automatically when set to System.',
    value: s.theme,
    options: [
      { value: 'system', label: 'System' },
      { value: 'light', label: 'Light' },
      { value: 'dark', label: 'Dark' }
    ],
    onChange: async (v) => { await updateSettings({ theme: v }); }
  }));
  root.appendChild(c);
}

/* ----------------------------- domain rules ------------------------------- */

function rulesSection(root, ctx) {
  root.appendChild(sectionHead('Custom domain rules',
    badge(`${Object.keys(store.settings.domainRules || {}).length}`, 'muted')
  ));
  root.appendChild(el('p', { class: 'section-sub', style: 'margin:-6px 0 12px', text: '“Always put github.com into Development.” Rules win over automatic analysis.' }));

  const c = card('card-pad settings-section');
  const rules = store.settings.domainRules || {};
  const list = el('div', { class: 'rules-table' });

  const hostInput = el('input', { class: 'input', placeholder: 'example.com', 'aria-label': 'Domain' });
  const catSelect = el('select', { class: 'input', style: 'width:auto', 'aria-label': 'Category' },
    CATEGORIES.map((cat) => el('option', { value: cat.id, text: `${cat.emoji} ${cat.name}` }))
  );
  list.appendChild(el('div', { class: 'rule-row' },
    hostInput, catSelect,
    el('button', {
      class: 'btn btn-secondary btn-sm', text: 'Add rule',
      onclick: async () => {
        const host = hostInput.value.trim().toLowerCase().replace(/^www\./, '');
        if (!host || !host.includes('.')) { toast('Enter a domain like “example.com”.'); return; }
        const { createDomainRule } = await import('../store.js');
        await createDomainRule(host, catSelect.value);
        toast(`Rule saved: ${host} → ${catSelect.options[catSelect.selectedIndex].text}.`, { type: 'success', timeout: 3500 });
        hostInput.value = '';
        ctx.rerender();
      }
    })
  ));
  list.appendChild(el('div', { class: 'menu-sep', style: 'margin:8px 0' }));

  const entries = Object.entries(rules).sort((a, b) => a[0].localeCompare(b[0]));
  if (!entries.length) {
    list.appendChild(el('p', { class: 'tab-host', text: 'No custom rules yet. You can also create them from a suggestion: open a tab’s ⋯ menu and pick “Always file this site here”.' }));
  }
  for (const [host, catId] of entries) {
    const cat = CATEGORIES.find((x) => x.id === catId);
    list.appendChild(el('div', { class: 'rule-row' },
      el('span', { class: 'tab-title', style: 'flex:1', text: host }),
      el('span', { class: 'badge badge-accent', text: cat ? `${cat.emoji} ${cat.name}` : catId }),
      el('button', {
        class: 'icon-btn', 'aria-label': `Delete rule for ${host}`,
        html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
        onclick: async () => {
          const { removeDomainRule } = await import('../store.js');
          await removeDomainRule(host);
          ctx.rerender();
        }
      })
    ));
  }
  c.appendChild(list);
  root.appendChild(c);
}

/* ---------------------------------- data ---------------------------------- */

function dataSection(root, ctx) {
  root.appendChild(sectionHead('Your data'));
  const c = card('card-pad settings-section');

  c.appendChild(el('p', { class: 'modal-text', text: 'Everything TabVault knows lives in this browser profile. Export a backup file any time; importing never touches your open tabs.' }));

  c.appendChild(el('div', { class: 'btn-row' },
    el('button', {
      class: 'btn btn-secondary btn-sm', text: 'Export full backup (JSON)',
      onclick: async () => {
        try {
          const data = await buildBackup({});
          const json = JSON.stringify(data, null, 2);
          const name = `tabvault-backup-${new Date().toISOString().slice(0, 10)}.json`;
          downloadText(name, 'application/json', json);
          toast(`Backup exported — ${data.workspaces.length} workspaces, ${data.snapshots.length} snapshots.`, { type: 'success' });
        } catch (e) {
          logError('export', e);
          toast(friendly(e), { type: 'error', timeout: 9000 });
        }
      }
    }),
    el('button', {
      class: 'btn btn-secondary btn-sm', text: 'Import backup…',
      onclick: () => importFlow(ctx)
    }),
    el('button', {
      class: 'btn btn-danger-ghost btn-sm', text: 'Reset TabVault data…',
      onclick: () => resetFlow(ctx)
    })
  ));
  root.appendChild(c);
}

async function importFlow(ctx) {
  const input = el('input', { type: 'file', accept: '.json,application/json', style: 'display:none' });
  document.body.appendChild(input);
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.remove();
    if (!file) return;
    let parsed;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      toast("This backup couldn't be imported. Your existing TabVault data is unchanged.", { type: 'error', timeout: 9000 });
      return;
    }
    const v = validateBackup(parsed);
    if (!v.ok) {
      logError('import validation', v.errors);
      toast("This backup couldn't be imported. Your existing TabVault data is unchanged.", { type: 'error', timeout: 9000 });
      return;
    }
    const { ok, checked } = await confirmDialog({
      title: 'Import backup?',
      message: `Found ${v.summary.workspaces} workspaces, ${v.summary.snapshots} snapshots (${v.summary.tabs} tab entries).`,
      html: el('p', { class: 'modal-text', text: 'Merge keeps everything you already have and adds what\'s new. Replace wipes current TabVault data first. Open tabs are never affected.' }),
      checkbox: 'Replace existing TabVault data (workspaces + snapshots)',
      confirmLabel: 'Import backup'
    });
    if (!ok) return;
    try {
      const res = await importBackup(v.data, {
        mode: checked ? 'replace' : 'merge',
        importSettings: checked && !!v.data.settings
      });
      await refreshData();
      toast(`Imported ${res.workspacesAdded + res.workspacesUpdated} workspaces and ${res.snapshotsAdded} snapshots.`, { type: 'success' });
      ctx.rerender();
    } catch (e) {
      logError('import', e);
      toast(friendly(e), { type: 'error', timeout: 9000 });
    }
  });
  input.click();
}

async function resetFlow(ctx) {
  const first = await confirmDialog({
    title: 'Reset TabVault data?',
    message: 'This deletes all workspaces, snapshots and settings stored by TabVault in this browser. Your open tabs and bookmarks are NOT affected.',
    confirmLabel: 'Continue', danger: true
  });
  if (!first.ok) return;
  const second = await confirmDialog({
    title: 'Are you sure?',
    message: 'This cannot be undone. Consider exporting a backup first.',
    confirmLabel: 'Delete everything', danger: true
  });
  if (!second.ok) return;
  try {
    const { idbClear } = await import('../../core/storage.js');
    await idbClear('workspaces');
    await idbClear('snapshots');
    await chrome.storage.local.remove(['settings', 'meta']);
    await refreshData();
    toast('TabVault data cleared. Starting fresh.', { type: 'success' });
    ctx.rerender();
  } catch (e) {
    logError('reset', e);
    toast(friendly(e), { type: 'error', timeout: 9000 });
  }
}

/* -------------------------------- row helpers ------------------------------ */

function switchRow({ name, desc, checked, onChange }) {
  const input = el('input', { type: 'checkbox', 'aria-label': name });
  input.checked = !!checked;
  input.addEventListener('change', async () => {
    try { await onChange(input.checked); }
    catch (e) {
      logError('setting', e);
      toast(friendly(e), { type: 'error' });
      input.checked = !input.checked;
    }
  });
  return el('div', { class: 'field-row' },
    el('div', { class: 'field-main' },
      el('div', { class: 'field-name', text: name }),
      el('div', { class: 'field-desc', text: desc })
    ),
    el('label', { class: 'switch field-ctl' }, input, el('span', { class: 'track' }))
  );
}

function selectRow({ name, desc, value, options, onChange }) {
  const sel = el('select', { class: 'input', style: 'width:auto', 'aria-label': name },
    options.map((o) => el('option', { value: o.value, text: o.label, selected: String(o.value) === String(value) }))
  );
  sel.addEventListener('change', async () => {
    try { await onChange(sel.value); }
    catch (e) {
      logError('setting', e);
      toast(friendly(e), { type: 'error' });
    }
  });
  return el('div', { class: 'field-row' },
    el('div', { class: 'field-main' },
      el('div', { class: 'field-name', text: name }),
      el('div', { class: 'field-desc', text: desc })
    ),
    el('div', { class: 'field-ctl' }, sel)
  );
}

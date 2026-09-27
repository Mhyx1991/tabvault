// Export / import (backup) system.
// Exports are ordinary files the user saves and re-imports. Nothing is ever
// uploaded anywhere. Import validates strictly BEFORE touching existing data.

import { DEFAULT_SETTINGS } from '../shared/constants.js';
import { uid } from '../shared/utils.js';
import { idbPut, idbGetAll, idbClear, idbBulkPut, saveSettings, getSettings } from './storage.js';
import { pruneSnapshots } from './snapshots.js';
import { escapeHtml } from '../shared/utils.js';

export const BACKUP_FORMAT = 'tabvault-backup';
export const BACKUP_VERSION = 1;

const LIMITS = { workspaces: 500, wsTabs: 5000, snapshots: 200, snapTabs: 5000 };

/* ------------------------------- export ------------------------------- */

export async function buildBackup({ includeSnapshots = true, includeSettings = true } = {}) {
  const workspaces = (await idbGetAll('workspaces')) || [];
  const snapshots = includeSnapshots ? (await idbGetAll('snapshots')) || [] : [];
  const settings = includeSettings ? await getSettings() : null;
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    app: 'TabVault',
    exportedAt: Date.now(),
    workspaces,
    snapshots,
    ...(settings ? { settings } : {})
  };
}

/* ----------------------------- validation ----------------------------- */

/**
 * Validate a parsed backup file. Returns
 * { ok, errors:[], summary:{workspaces,snapshots,tabs}, data:{workspaces,snapshots,settings?} }
 * The returned data is normalized (ids/timestamps filled in) and safe to import.
 */
export function validateBackup(raw) {
  const errors = [];
  const fail = (msg) => errors.push(msg);

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: ['File is not a TabVault backup (no JSON object found).'], summary: null, data: null };
  }
  if (raw.format !== BACKUP_FORMAT) {
    fail("This file doesn't have the TabVault backup format.");
  }
  const version = raw.version;
  if (typeof version !== 'number' || version < 1 || version > BACKUP_VERSION) {
    fail(`Unsupported backup version: ${JSON.stringify(version ?? null)}.`);
  }

  const workspaces = [];
  if (raw.workspaces != null) {
    if (!Array.isArray(raw.workspaces)) fail('"workspaces" must be a list.');
    else if (raw.workspaces.length > LIMITS.workspaces) fail(`Too many workspaces (max ${LIMITS.workspaces}).`);
    else {
      raw.workspaces.forEach((ws, i) => {
        const w = validateWorkspace(ws, i, fail);
        if (w) workspaces.push(w);
      });
    }
  }

  const snapshots = [];
  if (raw.snapshots != null) {
    if (!Array.isArray(raw.snapshots)) fail('"snapshots" must be a list.');
    else if (raw.snapshots.length > LIMITS.snapshots) fail(`Too many snapshots (max ${LIMITS.snapshots}).`);
    else {
      raw.snapshots.forEach((s, i) => {
        const snap = validateSnapshot(s, i, fail);
        if (snap) snapshots.push(snap);
      });
    }
  }

  let settings;
  if (raw.settings != null) {
    if (typeof raw.settings !== 'object' || Array.isArray(raw.settings)) {
      fail('"settings" must be an object.');
    } else {
      settings = sanitizeSettings(raw.settings);
    }
  }

  const summary = {
    workspaces: workspaces.length,
    snapshots: snapshots.length,
    tabs: workspaces.reduce((n, w) => n + w.tabs.length, 0) +
      snapshots.reduce((n, s) => n + s.windows.reduce((m, w) => m + (w.tabs?.length || 0), 0), 0)
  };

  if (errors.length) return { ok: false, errors, summary, data: null };
  return { ok: true, errors: [], summary, data: { workspaces, snapshots, settings } };
}

function validateWorkspace(ws, i, fail) {
  const where = `Workspace #${i + 1}`;
  if (!ws || typeof ws !== 'object' || Array.isArray(ws)) { fail(`${where} is malformed.`); return null; }
  if (typeof ws.name !== 'string' || !ws.name.trim()) { fail(`${where} has no name.`); return null; }
  if (!Array.isArray(ws.tabs)) { fail(`${where} has no tab list.`); return null; }
  if (ws.tabs.length > LIMITS.wsTabs) { fail(`${where} has too many tabs (max ${LIMITS.wsTabs}).`); return null; }
  const tabs = [];
  for (const t of ws.tabs) {
    if (!t || typeof t !== 'object' || typeof t.url !== 'string' || !t.url) continue;
    if (t.url.length > 4096) continue;
    tabs.push({ url: t.url, title: typeof t.title === 'string' ? t.title.slice(0, 600) : '', pinned: !!t.pinned });
  }
  return {
    id: typeof ws.id === 'string' && ws.id ? ws.id : uid(),
    name: ws.name.slice(0, 80),
    createdAt: numOr(ws.createdAt, Date.now()),
    updatedAt: numOr(ws.updatedAt, Date.now()),
    source: typeof ws.source === 'string' ? ws.source : 'imported',
    color: typeof ws.color === 'string' ? ws.color : 'blue',
    tabs
  };
}

function validateSnapshot(s, i, fail) {
  const where = `Snapshot #${i + 1}`;
  if (!s || typeof s !== 'object' || Array.isArray(s)) { fail(`${where} is malformed.`); return null; }
  if (typeof s.createdAt !== 'number' || !isFinite(s.createdAt)) { fail(`${where} has no valid date.`); return null; }
  if (!Array.isArray(s.windows)) { fail(`${where} has no window list.`); return null; }
  if (s.windows.length > LIMITS.snapTabs) { fail(`${where} has too many windows.`); return null; }
  const windows = [];
  let tabCount = 0;
  for (const w of s.windows) {
    if (!w || typeof w !== 'object' || !Array.isArray(w.tabs)) continue;
    if (tabCount > LIMITS.snapTabs) break;
    const tabs = [];
    for (const e of w.tabs) {
      if (!e || typeof e !== 'object' || typeof e.url !== 'string') continue;
      tabs.push({
        url: e.url.slice(0, 4096),
        title: typeof e.title === 'string' ? e.title.slice(0, 600) : '',
        pinned: !!e.pinned,
        index: typeof e.index === 'number' ? e.index : tabs.length,
        groupTitle: typeof e.groupTitle === 'string' ? e.groupTitle : '',
        groupColor: typeof e.groupColor === 'string' ? e.groupColor : '',
        tabId: typeof e.tabId === 'number' ? e.tabId : -1
      });
      tabCount++;
    }
    windows.push({ id: typeof w.id === 'number' ? w.id : -1, type: w.type || 'normal', state: w.state || 'normal', tabs });
  }
  return {
    id: typeof s.id === 'string' && s.id ? s.id : uid(),
    createdAt: s.createdAt,
    trigger: typeof s.trigger === 'string' ? s.trigger : 'imported',
    app: 'TabVault',
    version: 1,
    counts: { tabs: tabCount, windows: windows.length },
    truncated: false,
    windows
  };
}

function sanitizeSettings(s) {
  const out = {};
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (!(key in s)) continue;
    const def = DEFAULT_SETTINGS[key];
    const val = s[key];
    if (def !== null && typeof def === 'object') {
      if (val && typeof val === 'object' && !Array.isArray(val)) out[key] = val;
    } else if (typeof val === typeof def) {
      out[key] = val;
    }
  }
  return out;
}

function numOr(v, dflt) {
  return typeof v === 'number' && isFinite(v) ? v : dflt;
}

/* ------------------------------- import ------------------------------- */

/**
 * Apply a validated backup.
 * @param {{workspaces:Array, snapshots:Array, settings?:object}} data from validateBackup
 * @param {{mode:'merge'|'replace', importSettings?:boolean}} opts
 */
export async function importBackup(data, { mode = 'merge', importSettings = false } = {}) {
  const existingWorkspaces = new Map(((await idbGetAll('workspaces')) || []).map((w) => [w.id, w]));
  const existingSnapshots = new Set(((await idbGetAll('snapshots')) || []).map((s) => s.id));

  let workspacesAdded = 0, workspacesUpdated = 0, snapshotsAdded = 0, snapshotsSkipped = 0;

  const wsWrites = [];
  for (const ws of data.workspaces) {
    const existing = existingWorkspaces.get(ws.id);
    if (mode === 'replace') { wsWrites.push(ws); continue; }
    if (!existing) { wsWrites.push(ws); workspacesAdded++; }
    else if ((ws.updatedAt || 0) > (existing.updatedAt || 0)) { wsWrites.push(ws); workspacesUpdated++; }
    else { /* existing is same or newer — keep it */ }
  }

  const snapWrites = [];
  for (const s of data.snapshots) {
    if (mode !== 'replace' && existingSnapshots.has(s.id)) { snapshotsSkipped++; continue; }
    snapWrites.push(s);
    snapshotsAdded++;
  }

  if (mode === 'replace') {
    await idbClear('workspaces');
    await idbClear('snapshots');
    workspacesAdded = data.workspaces.length;
    snapshotsAdded = data.snapshots.length;
  }

  if (wsWrites.length) await idbBulkPut('workspaces', wsWrites);
  if (snapWrites.length) await idbBulkPut('snapshots', snapWrites);

  let settingsApplied = false;
  if (importSettings && data.settings) {
    await saveSettings(data.settings);
    settingsApplied = true;
  }

  try { await pruneSnapshots((await getSettings()).snapshotRetention); } catch { /* non-fatal */ }

  return { workspacesAdded, workspacesUpdated, snapshotsAdded, snapshotsSkipped, settingsApplied };
}

/* --------------------------- text exports ---------------------------- */

/** Export a workspace as {filename, mime, content} in json | markdown | html | txt. */
export function workspaceExport(ws, format = 'markdown') {
  const safe = (ws.name || 'workspace').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'workspace';
  const date = new Date(ws.updatedAt || Date.now()).toISOString().slice(0, 10);
  switch (format) {
    case 'json':
      return {
        filename: `${safe}-${date}.json`,
        mime: 'application/json',
        content: JSON.stringify({ format: 'tabvault-workspace', version: 1, ...ws }, null, 2)
      };
    case 'markdown':
      return {
        filename: `${safe}-${date}.md`,
        mime: 'text/markdown',
        content: `# ${ws.name}\n\n_Saved by TabVault · ${new Date(ws.updatedAt || Date.now()).toLocaleString()} · ${ws.tabs.length} tabs_\n\n` +
          ws.tabs.map((t) => `- [${t.title || t.url}](${t.url})`).join('\n') + '\n'
      };
    case 'html':
      return {
        filename: `${safe}-${date}.html`,
        mime: 'text/html',
        content: `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(ws.name)}</title>` +
          `<style>body{font-family:system-ui,sans-serif;max-width:760px;margin:2rem auto;padding:0 1rem;line-height:1.5}li{margin:.3rem 0}</style>` +
          `</head><body><h1>${escapeHtml(ws.name)}</h1><p>${ws.tabs.length} tabs · exported from TabVault</p><ul>` +
          ws.tabs.map((t) => `<li><a href="${escapeHtml(t.url)}">${escapeHtml(t.title || t.url)}</a></li>`).join('') +
          `</ul></body></html>`
      };
    default: // txt
      return {
        filename: `${safe}-${date}.txt`,
        mime: 'text/plain',
        content: `${ws.name}\n${'='.repeat(ws.name.length)}\n\n` +
          ws.tabs.map((t) => `${t.title || 'Untitled'}\n  ${t.url}`).join('\n\n') + '\n'
      };
  }
}

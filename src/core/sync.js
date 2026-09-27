// Optional settings sync via chrome.storage.sync (opt-in, OFF by default).
//
// Privacy contract (kept intact):
//  - Sync covers ONLY your preferences: theme, toggles, thresholds, category
//    names and custom domain rules. Never tab URLs, titles, snapshots or
//    workspace contents — your browsing history stays on your device.
//  - Nothing leaves the device until you flip the switch in Settings, and
//    chrome.storage.sync travels through your own Chrome profile account
//    (same mechanism Chrome itself uses for bookmarks), not any TabVault
//    server — TabVault has no server.
//  - Disabling sync stops all future pushes and clears the synced copy.
//
// Conflict rule: newest `syncedAt` wins; local unsynced changes newer than
// the cloud copy win on pull. Simple, predictable, no merge UI needed.

import { DEFAULT_SETTINGS } from '../shared/constants.js';
import { getSettings, saveSettings } from './storage.js';
import { TvError, logError } from './errors.js';

const SYNC_KEY = 'settings-sync';
const SYNCED_AT = 'syncedAt';

function syncAvailable() {
  return typeof chrome !== 'undefined' && !!chrome.storage?.sync;
}

/** Strip nothing today — all DEFAULT_SETTINGS keys are non-sensitive prefs.
 *  Kept as an explicit allowlist so future sensitive fields can't leak. */
function sanitizeForSync(settings) {
  const out = {};
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (key in settings) out[key] = settings[key];
  }
  return out;
}

async function readCloud() {
  if (!syncAvailable()) return null;
  const data = await chrome.storage.sync.get(SYNC_KEY);
  const entry = data[SYNC_KEY];
  if (!entry || typeof entry !== 'object' || !entry.settings) return null;
  return entry;
}

async function writeCloud(settings) {
  if (!syncAvailable()) throw new TvError('STORAGE_UNAVAILABLE', 'chrome.storage.sync is unavailable');
  const payload = {
    settings: sanitizeForSync(settings),
    [SYNCED_AT]: Date.now(),
    app: 'TabVault',
    v: 1
  };
  // storage.sync quota: 8 KB per item — our settings payload is ~1 KB.
  await chrome.storage.sync.set({ [SYNC_KEY]: payload });
}

/** Enable sync: push current settings to the cloud now and stamp local syncedAt
 *  so an immediate pull is correctly recognized as up-to-date. */
export async function enableSync() {
  const settings = await getSettings();
  const at = Date.now();
  await writeCloud({ ...settings, [SYNCED_AT]: at });
  await saveSettings({ syncedAt: at });
  return true;
}

/** Disable sync: stop pushing and remove the cloud copy (privacy default). */
export async function disableSync() {
  if (syncAvailable()) await chrome.storage.sync.remove(SYNC_KEY);
  return true;
}

/** Push local settings to the cloud (manual "Sync now" / auto after edits). */
export async function pushSettings() {
  const settings = await getSettings();
  await writeCloud(settings);
  return { pushedAt: Date.now() };
}

/**
 * Pull cloud settings into this device.
 * - If the cloud copy is newer than the last sync marker, it is applied.
 * - Only DEFAULT_SETTINGS keys are applied (allowlist).
 * Returns { applied: boolean, reason?: string, settings?: object }
 */
export async function pullSettings({ force = false } = {}) {
  const cloud = await readCloud();
  if (!cloud) return { applied: false, reason: 'empty' };

  const local = await getSettings();
  const cloudAt = cloud[SYNCED_AT] || 0;
  const localAt = local.syncedAt || 0;
  if (!force && cloudAt <= localAt) return { applied: false, reason: 'up-to-date' };

  const merged = { ...local };
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (key in cloud.settings) merged[key] = cloud.settings[key];
  }
  merged.syncedAt = cloudAt;
  const saved = await saveSettings(merged);
  return { applied: true, settings: saved };
}

/** Push after any settings change when sync is on (fire-and-forget helper). */
export async function pushIfEnabled(settings) {
  try {
    if (!settings?.syncEnabled) return;
    if (!syncAvailable()) return;
    await writeCloud(settings);
  } catch (e) {
    logError('pushIfEnabled', e); // never let sync break a settings save
  }
}

/** One-time boot pull: called by the service worker on browser start. */
export async function bootPull() {
  try {
    const settings = await getSettings();
    if (!settings.syncEnabled) return { applied: false, reason: 'disabled' };
    return await pullSettings();
  } catch (e) {
    logError('bootPull', e);
    return { applied: false, reason: 'error' };
  }
}

// TabVault shared constants — used by core logic, UI and the service worker.

export const APP_NAME = 'TabVault';
export const APP_TAGLINE = 'Organize your tabs. Keep what matters.';

/** Deterministic categories used by the local organization engine. */
export const CATEGORIES = [
  { id: 'work',           name: 'Work',           emoji: '💼', color: 'blue',   hint: 'Mail, docs, meetings, team tools' },
  { id: 'development',    name: 'Development',    emoji: '💻', color: 'green',  hint: 'Code, docs, infra, debugging' },
  { id: 'shopping',       name: 'Shopping',       emoji: '🛒', color: 'orange', hint: 'Stores, carts, deals' },
  { id: 'entertainment',  name: 'Entertainment',  emoji: '🎬', color: 'red',    hint: 'Video, music, streaming' },
  { id: 'news',           name: 'News',           emoji: '📰', color: 'yellow', hint: 'Articles, headlines, blogs' },
  { id: 'research',       name: 'Research',       emoji: '🔬', color: 'purple', hint: 'Papers, studies, courses' },
  { id: 'social',         name: 'Social',         emoji: '💬', color: 'cyan',   hint: 'Feeds, communities, chat' },
  { id: 'finance',        name: 'Finance',        emoji: '💰', color: 'grey',   hint: 'Banking, investing, crypto' }
];

export const CATEGORY_MAP = new Map(CATEGORIES.map((c) => [c.id, c]));

/** Rich icon palette for categories (pick in Settings). All render as Chrome
 *  group names fine; they're plain emoji characters. */
export const CATEGORY_EMOJIS = [
  '💼', '💻', '🛒', '🎬', '📰', '🔬', '💬', '💰',
  '📧', '☁️', '🧑‍💻', '🛠️', '🎮', '🎵', '🎧', '📺',
  '⚽', '🏋️', '🏥', '✈️', '🏝️', '🗺️', '🚗', '🏠',
  '🍜', '☕', '🍕', '🍲', '📖', '🎓', '✏️', '🎨',
  '🐾', '🌱', '⭐', '❤️', '🔥', '📁', '📌', '🗂️',
  '🤖', '🔒', '🌐', '📊', '🧪', '📅', '⏰', '🎁'
];

/** Hidden categories: user can remove a category from suggestions entirely. */
export function activeCategories(settings) {
  const hidden = settings?.hiddenCategories || [];
  return CATEGORIES.filter((c) => !hidden.includes(c.id));
}

export const UNSORTED = { id: 'unsorted', name: 'Unsorted', emoji: '📦', color: null, hint: 'Everything else' };

/** Valid chrome.tabGroups colors. */
export const CHROME_GROUP_COLORS = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];

export const GROUP_COLOR_HEX = {
  grey: '#8e9297',
  blue: '#4d8ef7',
  red: '#e8544f',
  yellow: '#f0a916',
  green: '#33a852',
  pink: '#ef6aa5',
  purple: '#a05ee1',
  cyan: '#2bb3c0',
  orange: '#f29900'
};

/** New-tab / blank pages that should never be grouped or counted as content. */
const IGNORABLE = new Set(['', 'about:blank', 'about:newtab', 'chrome://newtab/', 'chrome://new-tab-page/', 'edge://newtab/', 'about:home']);
export function isIgnorableUrl(url) {
  if (!url) return true;
  const u = String(url).toLowerCase();
  if (IGNORABLE.has(u)) return true;
  return u.startsWith('chrome://newtab') || u.startsWith('edge://newtab');
}

/** Rendering / size limits (keeps the UI responsive with 2,000+ tabs). */
export const LIMITS = {
  SNAPSHOT_MAX_TABS: 5000,
  LIST_RENDER: 60,
  SEARCH_RESULTS: 50,
  MENU_WIDTH: 220
};

export const DEFAULT_SETTINGS = {
  // Appearance
  theme: 'system', // 'light' | 'dark' | 'system'
  // Organization
  autoSuggest: true,
  preserveExistingGroups: true,
  minConfidence: 'medium', // 'low' | 'medium' | 'high'
  minGroupSize: 2,
  categoryNames: {},       // { [categoryId]: custom display name }
  domainRules: {},         // { [host]: categoryId } — user rules, win over defaults
  // Safety
  autoSnapshot: true,
  snapshotFrequencyHours: 24,
  snapshotRetention: 30,
  confirmBeforeClose: true,
  confirmBeforeOrganize: true,
  // Stale detection
  staleDays: 7,
  // Auto-grouping (background watcher files new tabs as they open)
  autoGroup: false,          // off by default — user opts in
  hiddenCategories: [],      // category ids removed from suggestions/settings
  tutorialDone: false,       // 3-step feature tour shown once after onboarding
  // Memory saver: discard (unload) tabs idle longer than this. 0 = off.
  discardAfterMinutes: 0,
  discardWhitelist: [],      // hostnames never discarded (user-managed)
  // Tab cap: warn when a window exceeds this many tabs. 0 = off.
  tabCap: 0,
  // Optional settings sync via chrome.storage.sync (prefs only, never history)
  syncEnabled: false,
  syncedAt: 0                // last sync marker (newest wins)
};

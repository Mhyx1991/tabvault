# TabVault

**Organize your tabs. Keep what matters.**

TabVault is a Chrome extension (Manifest V3) for people with too many tabs. It analyzes your open tabs locally, suggests logical Chrome tab groups, lets you review and edit the plan, and organizes with **snapshots + Undo** so you are never afraid to let it act.

> Open TabVault → Analyze → Review → Organize → Done.

- **Zero dependencies.** Plain ES modules, no build step, no frameworks, no network calls.
- **Local-first.** All data stays in your browser profile. No account, no cloud, no telemetry.
- **Safety-first.** Never closes or overwrites a tab without a review step; snapshots before every change.

---

## Install (unpacked, for development)

1. Generate the icons once (they are binary assets, kept out of git):
   ```
   npm run icons
   ```
2. Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select this project folder (the one containing `manifest.json`).
3. TabVault opens its dashboard automatically. Onboarding starts with your actual tab count.

## Scripts

| Command | What it does |
|---|---|
| `npm run check` | Syntax-checks every JS file (`node --check`) |
| `npm test` | Runs the unit tests for the pure logic modules (Node's built-in runner) |
| `npm run icons` | Regenerates `src/assets/icons/*.png` (dependency-free PNG encoder) |
| `npm run package` | Pre-flight-validates the manifest and writes `dist/tabvault-v<version>.zip` for the Chrome Web Store |

## How it works

```
src/
  background/service-worker.js   install defaults, baseline snapshot, periodic snapshot alarm
  core/
    categorize.js                deterministic local analysis (domains → keywords → search queries)
    duplicates.js                duplicate detection + keep-priority plan
    stale.js                     stale tab detection (chrome.tabs.Tab.lastAccessed)
    search.js                    local search across open tabs + workspaces
    snapshots.js                 capture/restore: layout-undo and open-missing restore
    organize.js                  suggestion → Chrome tab-group execution (snapshot-first)
    workspaces.js                saved tab collections; open as window / current / group
    backup.js                    strict export/import validation, JSON/MD/HTML/TXT exports
    storage.js                   chrome.storage.local (settings/meta) + IndexedDB (snapshots/workspaces)
    tabs.js                      batch tab/window operations with per-item error containment
  ui/
    dashboard.html/css/js        full dashboard (7 views) + global search
    popup.html/css/js            quick actions, instant search, one-click organize
    store.js                     shared UI state and actions
    components.js                modal/confirm/prompt/toast/menu toolkit (CSP-safe, no inline JS)
    views/                       overview, suggestions, workspaces, history, care, settings, privacy
  shared/                        constants + helpers
tests/                           unit tests for all pure-logic modules
scripts/                         icons / checks / packaging (all dependency-free)
```

### Organization engine (no AI required)

Signals in priority order: your custom domain rules → known domain map (exact host beats suffix) → keyword hits in title/URL → search-query words from Google/Bing/DDG result URLs. Each category gets a score and a **confidence**; tabs below your minimum-confidence setting land in **Unsorted** — never force-filed.

### Safety model

- A snapshot is captured before **every** organize/close action. If the snapshot fails, the action is cancelled — tabs unchanged.
- **Undo** restores the exact previous layout (windows, order, pinned state, groups) for living tabs by id; it never opens or closes tabs.
- **Restore** (History) opens what is missing from a snapshot, reusing already-open tabs by normalized URL; closing "extraneous" tabs is opt-in per restore.
- Duplicate and stale tabs are surfaced for review; **nothing is closed automatically**.

### Storage layout

| Store | Content |
|---|---|
| `chrome.storage.local` | settings, install metadata, last-organize pointer |
| IndexedDB `tabvault` → `snapshots` | full window/tab snapshots (retention-pruned) |
| IndexedDB `tabvault` → `workspaces` | saved workspaces |

## Chrome API notes & limitations

- `chrome.tabs.Tab.lastAccessed` (stale detection) requires Chrome 121+; the manifest sets `minimum_chrome_version` accordingly. Older Chrome: stale tabs are skipped, everything else works.
- `chrome.tabs.group` is supported since Chrome 88; grouping falls back to per-tab attempts if a batch fails, and cosmetic failures never lose tabs.
- Chrome does not persist tab-group titles across browser restarts — that is a platform behavior, not a TabVault bug.
- Incognito windows are never captured in snapshots.

## Testing

`npm test` covers the pure logic: categorization (domains, keywords, rules, thresholds, 2,000-tab performance smoke), duplicate detection and keep-priority, search scoring, backup validation (including malformed/oversized files) and all four workspace export formats.

Manual browser test matrix: see **TESTING.md**.

## Privacy

See **PRIVACY.md** and the in-product Privacy page. Short version: everything is stored locally, nothing is ever uploaded, there is no account and no analytics.

## Chrome Web Store

See **STORE.md** for the step-by-step submission checklist (zip packaging, listing copy, permission justifications, privacy tab answers).

## License

MIT — see `LICENSE`.

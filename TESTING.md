# Testing TabVault

Two layers:

1. **Automated unit tests** — `npm test` (Node's built-in test runner, no dependencies).
2. **Manual browser matrix** — the checklist below. Chrome's extension APIs cannot be faked in Node, so anything that touches real tabs/windows must be exercised in the browser.

## Automated coverage

| Area | File | Highlights |
|---|---|---|
| Categorization | `tests/categorize.test.js` | domain map, keyword scoring, search-query steering, user rules, thresholds, preserve-groups, 2,000-tab performance smoke (< 2s) |
| Duplicates | `tests/duplicates.test.js` | tracking-param/hash/`www` invariance, keep priority (active > pinned > recent), non-http/new-tab exclusion |
| Search | `tests/search.test.js` | title/host/URL/group fields, AND-token matching, recents fallback, workspace content search |
| Backup | `tests/backup.test.js` | strict validation, garbage input, wrong version, oversized payloads, id/timestamp normalization, all 4 export formats incl. HTML escaping |
| Utils | `tests/utils.test.js` | URL normalization, host extraction, hashing |
| Import-graph smoke | `tests/smoke.test.js` | every module imports cleanly against a stubbed `chrome` API |
| Integration (core) | `tests/integration.core.test.js` | full organize→undo round-trips against a **stateful fake Chrome** (real layout semantics), snapshot/restore semantics, close protection, workspace round-trips, failure injection |
| Integration (scale) | `tests/integration.scale.test.js` | 5,000-tab capture, 2,000-tab analysis budgets, 1,200-tab organize+exact undo, retention pruning, search latency |
| Integration (fuzz) | `tests/integration.fuzz.test.js` | 500 adversarial backup inputs, prototype-pollution attempts, corrupted snapshots, storage write failures, mid-flight tab closes, double-undo |

## Manual browser matrix

Load the unpacked extension (`npm run icons` first if icons are missing), then walk through:

### Tab management
- [ ] Open tab / close tab → header counts update without reopening the dashboard (live `chrome.tabs` events)
- [ ] Move a tab between windows → dashboard reflects the new window
- [ ] Create a Chrome group manually → it appears under "Existing Chrome groups" and is preserved by suggestions
- [ ] Rename a Chrome group manually → reflected after refresh
- [ ] Pinned tabs → shown with a Pinned badge; pinned tabs are excluded from stale detection
- [ ] Multiple windows → window count correct; organize groups per-window

### Organization
- [ ] 10 tabs mixed (Gmail, GitHub, Amazon, YouTube) → sensible suggestions, Apply creates real Chrome groups
- [ ] 100+ tabs (open a folder of bookmarks) → analysis stays responsive; lists paginate with "Show all"
- [ ] 500–2,000+ tabs (use a tab-sprouting page or an old profile) → no freeze; snapshot completes
- [ ] Duplicate-heavy set → duplicates count appears on Overview + Cleanup
- [ ] Existing user groups + "Preserve existing groups" on → those tabs are untouched
- [ ] Turn "Preserve" off and re-analyze → existing groups get re-suggested
- [ ] Unclear categories (about:blank, chrome://, exotic pages) → land in Unsorted, never force-filed

### Suggestion editing
- [ ] Rename group → custom name persists (category names survive re-analysis)
- [ ] Move a tab between groups via the ⋯ menu → counts update immediately
- [ ] Merge two groups → combined card
- [ ] Create custom group, add selected tabs → applies as its own Chrome group
- [ ] "Always file this site here" on a tab → rule appears in Settings; future analyses respect it
- [ ] Ignore suggestions → "Your tabs already look organized" state; re-analyze brings them back

### Recovery
- [ ] Apply an organization → success toast with an **Undo** action → Undo restores exact layout (order, pins, groups)
- [ ] Overview banner "Undo" after organizing
- [ ] Snapshot appears in History with "before organizing" badge; Preview shows tabs
- [ ] Restore a snapshot → missing tabs open in a new window, already-open tabs are reused (no duplicates)
- [ ] Restore with "close extraneous" checked → only non-snapshot tabs close; snapshot of previous state exists
- [ ] Close some tabs, restore a snapshot containing them → they come back

### Storage & errors
- [ ] Duplicate close with confirmation off (Settings) → closes immediately after snapshot
- [ ] Import a hand-edited/invalid JSON → friendly error, existing data unchanged
- [ ] Import a valid backup in merge mode → workspaces/snapshots added; duplicates skipped by id/newness
- [ ] Import with "Replace" → current data cleared and replaced (with double confirmation)
- [ ] Export full backup → file downloads; re-import round-trips
- [ ] Reset TabVault data → workspaces/snapshots/settings cleared; tabs untouched
- [ ] Offline: everything works (no network needed)

### Permissions
- [ ] `chrome://extensions` → TabVault requests only `tabs`, `tabGroups`, `storage`, `alarms`, `favicon` and **no host permissions**
- [ ] Works identically in Light/Dark/System themes
- [ ] Keyboard: `/` focuses dashboard search; Escape closes search/dialogs; all actions reachable by Tab
- [ ] Popup: search tab → activates it; Organize → review list → apply; Undo link works

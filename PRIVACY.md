# TabVault Privacy

**Your browsing data stays on your device.**

## What TabVault stores

All data lives inside your browser profile using Chrome's local storage (`chrome.storage.local`) and the extension's IndexedDB database (`tabvault`). Nothing is ever transmitted by TabVault — the extension makes no network requests, has no server, and contains no remote code.

| Data | Where | Purpose |
|---|---|---|
| Settings & custom domain rules | `chrome.storage.local` | Remember your preferences |
| Install metadata (installed date, last-organize pointer) | `chrome.storage.local` | Power Undo and the dashboard header |
| Snapshots (lists of open tabs/windows) | IndexedDB `tabvault` | Undo, History, Restore |
| Workspaces you save | IndexedDB `tabvault` | Reopen tab collections on demand |

## What leaves your device

Nothing. TabVault:

- has **no server** and **no account system**;
- makes **no network requests** of any kind;
- contains **no analytics, telemetry, or tracking**;
- never reads page contents — only tab titles and URLs that Chrome already exposes to extensions with the `tabs` permission;
- never captures **incognito** windows in snapshots.

## Permissions and why each one is needed

| Permission | Why |
|---|---|
| `tabs` | Read tab titles/URLs to group, search, and snapshot them; create and activate tabs when you ask. |
| `tabGroups` | Create/rename Chrome tab groups and preserve groups you made yourself. |
| `storage` | Save your settings and metadata on your device. |
| `alarms` | Take periodic snapshots while Chrome runs (only if automatic snapshots are on). |
| `favicon` | Show site icons next to tabs inside TabVault's own pages. |

No host permissions (`<all_urls>` etc.) are requested. TabVault cannot read the content of any page.

## Exports are user-initiated files

Exporting a backup or workspace writes a file to your Downloads folder — a normal local file operation. Where it goes afterward is entirely up to you.

## Deleting your data

Settings → Your data → **Reset TabVault data** deletes everything TabVault has stored. Uninstalling the extension also removes its stored data.

## If AI features are added later

They will be **off by default**, clearly disclosed, run only on text you explicitly choose to share, and the product will keep working without them. There are no "expensive AI calls for basic categorization" in this version — categorization is a deterministic, local algorithm.

# Chrome Web Store preparation

Everything you need to go from this repo to a published listing.

## 1. Build the package

```
npm run icons     # once, to generate the PNG icons
npm run check     # every file parses
npm test          # logic tests pass
npm run package   # → dist/tabvault-v1.0.0.zip
```

The packager validates that every file referenced by `manifest.json` exists, then zips `manifest.json` at the archive root together with `src/`, `README.md`, `PRIVACY.md` and `LICENSE` (excluding `tests/`, `scripts/`, `docs/`, `node_modules`, `dist`). Upload the zip at https://chrome.google.com/webstore/devconsole — Store method (self-hosted zip), not a GitHub zip.

## 2. Store listing

- **Name:** TabVault — Tab Organizer
- **Short description (132 chars max):**
  > Organize your tabs into smart groups, save workspaces, and undo anything. Local, private, no account needed.
- **Category:** Productivity → Tools
- **Language:** English
- **Screenshots:** 1280×800 (or 640×400). Capture: (1) Overview with the big tab count and **Organize My Tabs**, (2) Suggested organization cards, (3) History with snapshots, (4) Workspaces grid, (5) Popup search.
- **Small promo tile:** 440×280. **Marquee:** 1400×560 (optional but recommended).

## 3. Privacy tab (answers that match this codebase)

- **Single purpose:** Organize and manage the user's open browser tabs locally — grouping, searching, snapshots/undo, and saved workspaces.
- **Permission justifications:**
  - `tabs` — required to read tab titles/URLs for grouping, search and snapshots, and to create/activate tabs the user requests. Core function; cannot work without it.
  - `tabGroups` — required to create and rename Chrome tab groups and preserve existing ones.
  - `storage` — stores the user's settings and metadata on their device.
  - `alarms` — schedules periodic local snapshots if the user enables automatic snapshots.
  - `favicon` — displays site icons in TabVault's own pages.
- **Remote code:** None. No remotely hosted code, no CDNs, no eval.
- **Data usage disclosures:** does **not** collect personal data; does **not** sell data; **no** data is transferred for any purpose. Everything stays on-device (see `PRIVACY.md`).

## 4. Certification checklist

- [ ] Version bumped in `manifest.json` (and `package.json`) before each upload
- [ ] `dist/tabvault-v<version>.zip` built fresh with `npm run package`
- [ ] Installed the zip build manually and ran the TESTING.md matrix on the *packaged* copy
- [ ] No console errors on dashboard/popup/service worker in `chrome://extensions` → Service Worker → Inspect
- [ ] Description makes no impossible claims ("never lose a tab" is **not** claimed anywhere)
- [ ] Privacy policy URL: host `PRIVACY.md` (e.g. GitHub Pages) and paste the link in the listing

## 5. Versioning

Semver: patch for fixes, minor for features, major for data-format changes. The backup format carries `version: 1`; if it ever changes, `validateBackup` must accept old versions and `BACKUP_VERSION` must bump.

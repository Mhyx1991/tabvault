# TabVault — Chrome Web Store Launch Kit (v1.1.0)

Everything needed to publish and market TabVault. The upload artifact is
`dist/tabvault-v1.1.0.zip` (rebuilt with the tutorial, 48 files, 313 KB).

---

## 1. Pre-flight checklist

| Item | Status |
|---|---|
| Zip built with latest code | ✅ `node scripts/package.js` → `dist/tabvault-v1.1.0.zip` |
| Manifest valid (MV3, min Chrome 114) | ✅ |
| 128×128 icon | ✅ `src/assets/icons/icon128.png` |
| No remote code / no external deps | ✅ — fast review, no CWS "remote code" flags |
| Privacy policy | ✅ `PRIVACY.md` ships in the zip; host it publicly (GitHub Gist / repo) for the listing URL |
| Tests green before packaging | ✅ 124/124, 51 files parse |
| Screenshots 1280×800 or 640×400 | ⬜ capture from the QA harness at 1280×800 (see §6) |
| Small promo tile 440×280 | ⬜ optional but recommended |
| Developer registration ($5 one-time) | ⬜ https://chrome.google.com/webstore/devconsole |

---

## 2. Listing copy (marketing voice)

**Name:** `TabVault: Tab Groups, Snapshots & Memory Saver`

**Short description (132 chars max):**
> Organize tabs into groups, snapshot & undo everything, save memory by sleeping idle tabs. 100% offline & private.

(126 chars — fits.)

**Long description:**

> **Your tabs, organized. Your memory, freed. Nothing ever lost.**
>
> TabVault is the tab manager for people with 50+ tabs open and no plan.
> One click sorts everything into Chrome tab groups, snapshots let you
> undo any tab disaster, and the memory saver sleeps tabs you forgot
> about so Chrome stops eating your RAM.
>
> 🔀 **Organize in one click** — AI-style categorization sorts tabs into
> groups like Work, Dev, Social, Shopping & Docs. Customize names and
> emoji, hide categories you don't use.
>
> 🛟 **Nothing is ever lost** — automatic snapshots of every window.
> Closed too much? Restore the exact set of tabs you had. Undo, history,
> restore — your tabs are never gone for good.
>
> 🧹 **Cleanup crew** — find duplicate tabs, cluster 10 open pages from
> the same site into one group, and park stale tabs you haven't touched
> in days.
>
> 💤 **Memory saver** — sleeping tabs free RAM instantly. A badge warns
> you before you hit your tab limit, so Chrome stays fast.
>
> 📌 **Stash everything** — one click stashes your entire window for
> later, with a built-in safety undo.
>
> 🗂️ **Workspaces** — save a set of tabs as a named workspace (Home,
> Project X, Weekend…) and reopen the whole set any time.
>
> 🔎 **Global search** — find any tab, group, workspace or snapshot
> instantly.
>
> 🌗 **Side panel + popup + keyboard shortcut** (Ctrl+Shift+K) — TabVault
> lives where you work.
>
> 🔒 **Private by design** — no account, no server, no analytics, no
> network requests. Everything is stored locally in your browser. Your
> tabs are your business.
>
> Perfect for researchers, developers, students, tab hoarders, and anyone
> whose tab strip has become a horror movie.

**Category:** Productivity
**Language:** English (US)

**Keywords to work into the listing (CWS search reads title, short desc & long desc):**
`tab manager`, `tab group organizer`, `tab groups`, `memory saver`, `tab
suspender`, `save tabs`, `tab cleanup`, `duplicate tabs`, `workspaces`,
`session manager`, `undo close tabs`, `RAM saver`, `offline`, `private`

---

## 3. Privacy tab answers (copy-paste)

- **Single purpose:** Organize, snapshot, and clean up browser tabs — all
  locally, with no network activity.
- **Permission justifications:**
  - `tabs` — Read tab titles/URLs to group, search, and snapshot tabs;
    create/activate tabs when the user asks. Required for every core
    feature (organize, cleanup, snapshots, workspaces).
  - `tabGroups` — Create and rename Chrome tab groups when organizing;
    preserve groups the user made manually.
  - `storage` — Persist settings, metadata, snapshots and workspaces
    locally on the user's device.
  - `alarms` — Take hourly automatic snapshots while Chrome runs (only
    when the user enables automatic snapshots). No polling.
  - `favicon` — Display site icons next to tabs inside TabVault's own
    extension pages only.
  - `sidePanel` — Open TabVault in Chrome's side panel for persistent
    access while browsing.
- **Data usage:** Does NOT comply with the "data disclosure" requirement?
  → No. Check "No" — TabVault collects nothing, transmits nothing.
  All storage is local (`chrome.storage.local` + IndexedDB) and is
  deleted on uninstall or via Settings → Reset TabVault data.
- **Privacy policy URL:** host `PRIVACY.md` (e.g. GitHub Gist) and paste
  the raw URL.

---

## 4. Step-by-step upload

1. **Register** ($5 one-time fee): https://chrome.google.com/webstore/devconsole
2. **Host the privacy policy** — put `PRIVACY.md` on GitHub (repo or Gist),
   keep the URL.
3. **Capture screenshots** (see §6) — at least 3, 1280×800.
4. **Build the final zip:** `node scripts/package.js` → `dist/tabvault-v1.1.0.zip`.
   Verify the tutorial change is inside (it is — rebuilt this session).
5. **Go to Developer Console → New item** → upload the zip.
6. **Store listing tab:**
   - Name, short description, long description (copy from §2)
   - Category: Productivity; Language: English (US)
7. **Privacy tab:** fill in everything from §3.
8. **Distribution tab:** every country (default), no pricing (free).
9. **Upload assets:** 1 small promo tile (440×280) optional, 3–5
   screenshots (1280×800), icon is taken from the manifest.
10. **Submit for review.** With no host permissions and no remote code,
    reviews typically clear in hours-to-a-few-days.
11. **After approval:** the item URL appears; share it everywhere in §7.

**Gotchas:**
- The zip must have `manifest.json` at the root — `package.js` handles this.
- Don't bump version in the zip without updating `manifest.json` version.
- Screenshots can't contain real personal browsing data — use the harness
  (seeded fake tabs), which is exactly what it's for.

---

## 5. Review-risk notes (why this will pass fast)

- No `<all_urls>` host permissions → avoids the deep "broad host
  permissions" review track.
- No remote code, no eval, no external fetches → no CWS remote-code flag.
- `favicon` permission with `web_accessible_resources` for `_favicon/*`
  is a known pattern; justification is listed in §3.
- Minimal permissions, all with clear justifications.

---

## 6. Screenshot plan (capture from QA harness at 1280×800)

Serve the harness (`python -m http.server PORT --bind 127.0.0.1` from
project root, **new port each time** — http.server caches stale files),
resize the preview to 1280×800, and screenshot:

1. **Overview/hero** — dashboard with grouped tabs visible (the money shot;
   put it first).
2. **Snapshots/Undo** — history view with a snapshot and the undo notice.
3. **Cleanup** — duplicates + same-site clusters view.
4. **Memory saver / Care view** — sleeping tabs + tab-cap badge.
5. **Side panel** — if easy, a composite showing the side panel next to a
   busy tab strip.

Good screenshots show grouped color tabs and readable titles — the seed
data already has realistic fake tabs.

---

## 7. Marketing plan (in order)

**Day 0 — launch assets**
- Store listing live (link = your hero URL, put it everywhere).
- 3-post X/Twitter thread with screenshots + store link.
- Reddit: r/chrome + r/chrome_extensions — title like
  *"I built a free, fully-offline tab organizer with snapshots/undo —
  no account, no tracking, no server"*. Be genuine, answer comments.
- Post in r/SideProject for the maker audience.

**Week 1**
- **Product Hunt launch** — Tuesday–Thursday, 12:01am PT. Maker comment
  first, gallery images ready, first-hour replies matter. Tagline:
  *"Organize tabs, free RAM, never lose a tab — 100% offline."*
- **Hacker News "Show HN"** — *Show HN: TabVault – offline tab organizer
  with snapshots and memory saver (zero deps, no server)*. The
  "zero-dependency, no network requests" engineering angle plays well.
- Personal network / LinkedIn if relevant.

**Week 2+**
- **SEO landing page** (GitHub Pages is fine): target "chrome tab group
  organizer", "chrome memory saver", "tab manager chrome". Link to store.
- Answer existing questions on r/chrome and Superuser about tab bloat —
  helpful answer + link only where rules allow.
- Collect reviews: the tutorial's last step ("Got it — let's go") is a
  natural place for a future "Enjoying TabVault? Leave a review" prompt
  (add later — don't ship review prompts in v1).
- Iterate: store reviews are the cheapest feature-vote system you have.

**Long-term keywords** (keep in listing + landing page): tab manager, tab
groups, memory saver, tab suspender, session manager, duplicate tab
finder, offline, private, no account.

**What NOT to do:** no paid ads before organic traction; no review
swaps; don't spam subreddits — one honest post per community, then
engage in comments.

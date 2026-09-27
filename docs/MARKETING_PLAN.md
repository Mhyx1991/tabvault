# TabVault — 1-Month Marketing Plan

Hand this document to any assistant/agent/person. It is self-contained: product facts, assets, weekly actions, ready-made copy, and success metrics.

---

## 0. Product facts (context for all copy)

- **Product:** TabVault — Chrome MV3 extension, v1.1.0, free
- **Store link:** (paste the Chrome Web Store URL after review passes)
- **Core features:** one-click tab organizing into Chrome tab groups; automatic snapshots + one-click undo (nothing is ever lost); duplicate/stale tab cleanup; memory saver (sleeps idle tabs, tab-cap badge); stash-all with undo; workspaces; global search; popup + side panel + shortcut (Ctrl+Shift+K / Cmd+Shift+K)
- **THE differentiator:** 100% offline. No account, no server, no analytics, no network requests, no remote code. Every competitor in this space collects browsing data; TabVault collects nothing.
- **Proof points:** zero dependencies, 124 automated tests, ~313 KB package, works fully without any sign-up
- **Target users:** developers, researchers/students, tab hoarders (50+ tabs), privacy-conscious users
- **Tone:** honest maker voice. Never spammy. "I built this because my tab strip was a horror movie."

## 1. Assets inventory

| Asset | Location / status |
|---|---|
| Store listing (copy-paste ready) | docs/STORE_LAUNCH.md §2 |
| 8 screenshots 1280×800 | store-assets/screenshots/ |
| Privacy policy | GitHub Gist URL (created during submission) |
| Launch doc | docs/STORE_LAUNCH.md |
| Version bump workflow | `node scripts/package.js` → dist zip |

**Missing (create when needed):** 440×280 promo tile, SEO landing page, demo GIF (optional, boosts Reddit/X posts).

## 2. Positioning statement (use everywhere)

> TabVault organizes your tabs, snapshots everything so you can undo any mistake, and sleeps forgotten tabs to free RAM — all 100% offline. No account. No tracking. No server. Your tabs are your business.

Taglines (rotate per channel):
- "Organize tabs, free RAM, never lose a tab — 100% offline."
- "The tab manager with an undo button for everything."
- "Tab groups, snapshots, memory saver — zero data collection."

## 3. Week-by-week plan

### Week 1 — Launch groundwork + first waves
| Day | Action |
|---|---|
| Mon | Confirm store listing live. Install it from the store on own machine (real user flow). Fix anything broken immediately. |
| Tue | **Reddit r/chrome post** (copy in §4.1). Reply to every comment for 48h. |
| Wed | **X/Twitter thread** (§4.2). Pin it. Follow 20 privacy/dev accounts. |
| Thu | **r/chrome_extensions post** (variation of §4.1). |
| Fri | **r/SideProject post** — maker angle, ask for feedback explicitly. |
| Sat–Sun | Respond to all comments everywhere. Log every question/objection in a feedback file (they become FAQ/README content). |

**Week 1 target:** 100–300 installs, 2+ honest reviews, all posts answered <2h.

### Week 2 — Big platforms
| Day | Action |
|---|---|
| Mon | Prepare Product Hunt: account, gallery (reuse store screenshots), tagline (§4.3), first-comment draft. |
| Tue–Thu | **Product Hunt launch** (Tue or Thu, 00:01 PT). Be online all day. Every comment gets a real reply within 30 min. |
| Fri | **Show HN** post (§4.4), weekday morning US time. Lead with the engineering angle: zero deps, no network requests, MV3, tested. |
| Sat–Sun | Convert PH/HN feedback into a public changelog/roadmap note. Ship one tiny fix if possible — "you asked, shipped same week" is marketing gold. |

**Week 2 target:** 500–1,500 cumulative installs, 5+ reviews.

### Week 3 — Durable channels
| Day | Action |
|---|---|
| Mon–Tue | **SEO landing page** (GitHub Pages, free): title "TabVault — Chrome Tab Group Organizer & Memory Saver", sections mirroring the store listing, screenshots, store link, FAQ (see §5 keywords). |
| Wed | Post the landing page on r/webdev or personal socials as "made a landing page for my extension" (secondary wave). |
| Thu | Find 5–10 existing Reddit/SuperUser/forum threads asking "how to organize chrome tabs / chrome using too much memory". Answer helpfully first; link only where rules allow. |
| Fri | Submit TabVault to extension directories/listicles: alternativeTo (as Chrome tab manager), extension directories, "best chrome extensions" blog contact emails (short pitch §4.5). |
| Weekend | Write one short article: "How I organize 50+ tabs without losing anything" — dev.to/Medium, links to store. |

**Week 3 target:** landing page indexed, 1–2 directory listings live, 1 article published.

### Week 4 — Optimize + compound
| Day | Action |
|---|---|
| Mon | Review store dashboard: views vs installs. If views high / installs low → rewrite first screenshot order + short description. If installs high / reviews low → add a gentle review ask inside the app (next version). |
| Tue | Second X thread: post a demo GIF of organize+undo in action. |
| Wed | Ship a small update (v1.1.1) with the week's top feedback item. Store "recently updated" is itself visibility. |
| Thu | Reach out to 5 micro-newsletters/bloggers covering browser productivity (personal short pitch §4.5). |
| Fri | Write month-1 retro: installs, reviews, best channel, worst channel. Plan month 2 based on data, not vibes. |

**Month-1 target:** 1,000–3,000 installs, 10+ reviews, rating ≥ 4.5, one channel identified as clearly best (then double down in month 2).

## 4. Ready-made copy

### 4.1 Reddit post (r/chrome, r/chrome_extensions)
> **Title:** I built a tab organizer that works 100% offline — no account, no tracking, no server
>
> Body: Like everyone here, my tab strip was a horror movie. I tried existing tab managers, but they all either want an account or silently collect browsing data — so I spent months building one that literally makes zero network requests.
>
> What it does: one click groups your tabs (Work, Dev, Social...), takes a snapshot before every change so you can undo anything, finds duplicates/stale tabs, sleeps forgotten tabs to free RAM, and saves tab sets as workspaces.
>
> It's free, ~313 KB, zero dependencies, no sign-up. Everything stays on your device. Happy to answer anything about how it works — feedback very welcome.
>
> Store link: [URL]

### 4.2 X/Twitter thread (4 tweets)
1. My tab strip used to be a horror movie: 60+ tabs, no plan, permanent guilt. So I built TabVault — a tab organizer with an undo button for everything. 🧵
2. One click sorts tabs into Chrome tab groups. Before every change it snapshots everything — close too much? Restore the exact set you had. Nothing is ever lost.
3. It also finds duplicates, parks stale tabs, sleeps forgotten ones to free RAM, and saves tab sets as workspaces you can reopen any time.
4. And the part I'm proudest of: it's 100% offline. No account, no analytics, no server, no network requests. Your tabs are your business. Free on the Chrome Web Store: [URL]

### 4.3 Product Hunt
- **Tagline:** Organize tabs, free RAM, never lose a tab — 100% offline
- **Description:** TabVault is the tab manager for people with 50+ tabs open and no plan. One-click organizing into Chrome tab groups, snapshots + undo so nothing is ever lost, duplicate cleanup, memory saver, and workspaces. No account, no tracking, no server — everything stays on your device.
- **Maker comment:** honest story — the tab-chaos problem, why existing tools want your data, why "zero network requests" was a non-negotiable design decision, what's next. Ask for blunt feedback.

### 4.4 Hacker News
- **Title:** Show HN: TabVault – offline tab organizer with snapshots and memory saver (zero dependencies, no server)
- **First comment:** architecture summary — MV3 service worker, coalesced rAF renders, IndexedDB snapshots, hourly alarm max-20-discards pass, no polling, 124 tests, deliberate decision to avoid any analytics even though it hurts growth. Invite scrutiny.

### 4.5 Cold pitch (newsletters/bloggers, 3 sentences)
> Hi [name] — I made TabVault, a free Chrome extension that organizes tabs into groups, snapshots everything so users can undo any tab disaster, and sleeps idle tabs to free RAM. The twist: it's fully offline — no account, no analytics, no server, which is rare in this category. Would [publication] be interested in a mention or a short review? Happy to answer anything.

## 5. SEO keywords (landing page + anywhere googleable)

Primary: chrome tab group organizer, chrome tab manager, memory saver chrome, tab suspender
Secondary: save tabs chrome, duplicate tab finder, session manager chrome, undo close tabs, organize tabs automatically, offline chrome extension, private tab manager

## 6. Rules (hard constraints)

1. Never buy installs/reviews or do review swaps — store ban risk.
2. One honest post per community; invest time in replies, not reposts.
3. Always disclose you're the maker.
4. No engagement-bait or fake urgency; the product's privacy angle is the story.
5. Respond to every comment under your own posts within a few hours.
6. Track weekly: store views, installs, reviews, referrer of best channel.

## 7. Metrics dashboard (update weekly)

| Metric | W1 | W2 | W3 | W4 |
|---|---|---|---|---|
| Store listing views | | | | |
| Installs | | | | |
| Reviews / rating | | | | |
| Best channel (by installs) | | | | |
| Top user request | | | | |

// Realistic tab corpora for stress tests.

const KINDS = [
  { cat: 'work', urls: ['https://mail.google.com/mail/u/0', 'https://docs.google.com/document/d/abc', 'https://slack.com/app', 'https://notion.so/My-Notes', 'https://outlook.office.com/mail/'] },
  { cat: 'development', urls: ['https://github.com/facebook/react', 'https://stackoverflow.com/questions/1/x', 'https://developer.mozilla.org/en-US/docs/Web/JS', 'https://aws.amazon.com/console/', 'https://docs.docker.com/engine/'] },
  { cat: 'shopping', urls: ['https://www.amazon.de/dp/B08N5', 'https://shopee.sg/product-i.123', 'https://www.ebay.com/itm/456', 'https://www.etsy.com/listing/789'] },
  { cat: 'entertainment', urls: ['https://www.youtube.com/watch?v=k1', 'https://www.netflix.com/watch/8', 'https://open.spotify.com/playlist/x', 'https://www.twitch.tv/streamer'] },
  { cat: 'news', urls: ['https://www.nytimes.com/2026/09/01/a', 'https://www.bbc.com/news/b', 'https://news.ycombinator.com/item?id=1', 'https://www.theverge.com/c'] },
  { cat: 'research', urls: ['https://arxiv.org/abs/2401.1', 'https://en.wikipedia.org/wiki/Test', 'https://scholar.google.com/s?q=x'] },
  { cat: 'social', urls: ['https://www.reddit.com/r/chrome/', 'https://x.com/user/1', 'https://www.instagram.com/p/x'] },
  { cat: 'unsorted-ish', urls: ['https://example.com/page', 'https://random-site.org/about', 'chrome://newtab/', 'about:blank'] }
];

/** Deterministic PRNG so stress runs are reproducible. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Generate n tabs spread across windows.
 * @returns {Array<{url,title,lastAccessed,pinned,windowIndex}>}
 */
export function generateTabs(n, { windows = 1, seed = 42, dupRate = 0.15, staleRate = 0.2, now = Date.now() } = {}) {
  const rnd = mulberry32(seed);
  const out = [];
  const pool = KINDS.flatMap((k) => k.urls);
  for (let i = 0; i < n; i++) {
    let url = pool[Math.floor(rnd() * pool.length)];
    if (rnd() < dupRate) url = pool[Math.floor(rnd() * pool.length)]; // force duplicates
    const kind = KINDS.find((k) => k.urls.includes(url));
    const title = `${kind ? kind.cat : 'page'} tab ${i}`;
    const lastAccessed = rnd() < staleRate ? now - 40 * 86_400_000 - rnd() * 86_400_000 : now - rnd() * 3 * 86_400_000;
    out.push({
      url,
      title,
      lastAccessed,
      pinned: rnd() < 0.03,
      windowIndex: Math.floor(rnd() * windows)
    });
  }
  return out;
}

/** Corrupt/garbage inputs for fuzzing the validator. */
export function garbageInputs(count, seed = 7) {
  const rnd = mulberry32(seed);
  const atoms = [
    null, undefined, 42, 'string', true, [], [1, 2, 3], {},
    { format: 'tabvault-backup' }, { format: 'nope', version: 1 },
    { format: 'tabvault-backup', version: 0 }, { format: 'tabvault-backup', version: 1e9 },
    { format: 'tabvault-backup', version: 1, workspaces: 'x' },
    { format: 'tabvault-backup', version: 1, workspaces: [null] },
    { format: 'tabvault-backup', version: 1, workspaces: [{ name: '' }] },
    { format: 'tabvault-backup', version: 1, workspaces: [{ name: 'x', tabs: [{ url: 42 }] }] },
    { format: 'tabvault-backup', version: 1, snapshots: [{ createdAt: 'yesterday' }] },
    { format: 'tabvault-backup', version: 1, settings: [] },
    { format: 'tabvault-backup', version: 1, workspaces: Array(600).fill({ name: 'x', tabs: [] }) },
    { format: 'tabvault-backup', version: 1, workspaces: [{ name: 'x', tabs: Array(6000).fill({ url: 'https://a.com/' }) }] },
    { format: 'tabvault-backup', version: 1, workspaces: [{ name: 'x', tabs: [{ url: 'x'.repeat(5000) }] }] },
    { format: 'tabvault-backup', version: 1, workspaces: [{ name: 'x'.repeat(5000), tabs: [] }] },
    { format: 'tabvault-backup', version: 1, snapshots: Array(300).fill({ createdAt: 1, windows: [] }) }
  ];
  const out = [];
  for (let i = 0; i < count; i++) {
    const roll = rnd();
    if (roll < 0.4) {
      out.push(atoms[Math.floor(rnd() * atoms.length)]);
    } else if (roll < 0.7) {
      // Deeply nested junk
      let v = { url: 'https://a.com/' };
      for (let d = 0; d < 8; d++) v = { tabs: [v] };
      out.push({ format: 'tabvault-backup', version: 1, workspaces: [v] });
    } else if (roll < 0.85) {
      // Random keys with wrong types everywhere
      out.push({
        format: 'tabvault-backup', version: 1,
        workspaces: [{ id: 42, name: ['x'], createdAt: {}, updatedAt: 'no', source: 1, color: 2, tabs: [{ url: [], title: 5, pinned: 'yes' }] }],
        snapshots: [{ id: [], createdAt: {}, windows: [null, 3, { tabs: 'x' }, { tabs: [{ url: {} }] }] }],
        settings: { theme: 42, autoSnapshot: 'yes', snapshotRetention: -5, domainRules: [], categoryNames: 1, staleDays: null }
      });
    } else {
      // Prototype-pollution style keys
      out.push({
        format: 'tabvault-backup', version: 1,
        workspaces: [{ name: '__proto__', tabs: [] }],
        settings: JSON.parse('{"__proto__":{"polluted":true},"theme":"dark"}')
      });
    }
  }
  return out;
}

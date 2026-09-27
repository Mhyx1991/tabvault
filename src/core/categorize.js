// Deterministic, fully-local tab categorization engine.
//
// Signals (in priority order):
//   1. User domain rules ("always put github.com into Development")
//   2. Known domain → category map (exact host > suffix match)
//   3. Keyword matches in title / URL path
//   4. Search-query text from Google/Bing/DuckDuckGo/Brave result URLs
//
// Nothing here touches the network and nothing scrapes page contents —
// only title + URL, which the "tabs" permission already exposes.

import { CATEGORIES, CATEGORY_MAP, UNSORTED, isIgnorableUrl } from '../shared/constants.js';
import { hostOf, urlPathOf, isHttpUrl } from '../shared/utils.js';

/* ------------------------- default domain map ------------------------- */
/* key matches host exactly or as a dot-suffix (e.g. "amazon.de" matches "www.amazon.de") */

export const DEFAULT_DOMAIN_RULES = {
  // Work
  'mail.google.com': 'work', 'docs.google.com': 'work', 'drive.google.com': 'work',
  'calendar.google.com': 'work', 'meet.google.com': 'work', 'sheets.google.com': 'work',
  'slides.google.com': 'work', 'forms.google.com': 'work', 'keep.google.com': 'work',
  'chat.google.com': 'work', 'script.google.com': 'work',
  'slack.com': 'work', 'notion.so': 'work', 'teams.microsoft.com': 'work',
  'outlook.office.com': 'work', 'outlook.live.com': 'work', 'office.com': 'work',
  'sharepoint.com': 'work', 'onedrive.live.com': 'work', 'dropbox.com': 'work',
  'paper.dropbox.com': 'work', 'zoom.us': 'work', 'linkedin.com': 'work',
  'asana.com': 'work', 'trello.com': 'work', 'clickup.com': 'work', 'basecamp.com': 'work',
  'airtable.com': 'work', 'linear.app': 'work', 'miro.com': 'work', 'figma.com': 'work',
  'confluence.atlassian.net': 'work', 'atlassian.net': 'work', 'bitbucket.org': 'work',
  'hubspot.com': 'work', 'salesforce.com': 'work', 'zendesk.com': 'work',
  '1password.com': 'work', 'bitwarden.com': 'work', 'calendly.com': 'work',
  'mail.yahoo.com': 'work', 'outlook.com': 'work',
  // Development
  'github.com': 'development', 'gist.github.com': 'development', 'gitlab.com': 'development',
  'stackoverflow.com': 'development', 'stackexchange.com': 'development', 'superuser.com': 'development',
  'serverfault.com': 'development', 'developer.mozilla.org': 'development', 'npmjs.com': 'development',
  'npmjs.org': 'development', 'nodejs.org': 'development', 'python.org': 'development',
  'devdocs.io': 'development', 'caniuse.com': 'development', 'regex101.com': 'development',
  'codepen.io': 'development', 'jsfiddle.net': 'development', 'codesandbox.io': 'development',
  'stackblitz.com': 'development', 'replit.com': 'development', 'vercel.com': 'development',
  'netlify.com': 'development', 'railway.app': 'development', 'render.com': 'development',
  'aws.amazon.com': 'development', 'console.aws.amazon.com': 'development',
  'console.cloud.google.com': 'development', 'cloud.google.com': 'development',
  'portal.azure.com': 'development', 'azure.microsoft.com': 'development',
  'docker.com': 'development', 'kubernetes.io': 'development', 'chromium.org': 'development',
  'developer.chrome.com': 'development', 'w3.org': 'development', 'sqlite.org': 'development',
  'postgresql.org': 'development', 'redis.io': 'development', 'mongodb.com': 'development',
  'tailwindcss.com': 'development', 'react.dev': 'development', 'vuejs.org': 'development',
  'angular.io': 'development', 'svelte.dev': 'development', 'nextjs.org': 'development',
  'vitejs.dev': 'development', 'typescriptlang.org': 'development', 'eslint.org': 'development',
  'webpack.js.org': 'development', 'crates.io': 'development', 'rust-lang.org': 'development',
  'go.dev': 'development', 'golang.org': 'development', 'ruby-lang.org': 'development',
  'swift.org': 'development', 'dotnet.microsoft.com': 'development', 'learn.microsoft.com': 'development',
  'leetcode.com': 'development', 'hackerrank.com': 'development', 'codewars.com': 'development',
  'huggingface.co': 'development', 'readthedocs.io': 'development', 'jetbrains.com': 'development',
  'dev.to': 'development', 'code.visualstudio.com': 'development',
  // Shopping
  'amazon.com': 'shopping', 'amazon.co.uk': 'shopping', 'amazon.de': 'shopping', 'amazon.ca': 'shopping',
  'amazon.in': 'shopping', 'amazon.es': 'shopping', 'amazon.fr': 'shopping', 'amazon.it': 'shopping',
  'amazon.nl': 'shopping', 'amazon.com.au': 'shopping', 'amazon.com.mx': 'shopping', 'amazon.com.br': 'shopping',
  'amazon.ae': 'shopping', 'amazon.sg': 'shopping', 'amazon.co.jp': 'shopping',
  'shopee.sg': 'shopping', 'shopee.com.my': 'shopping', 'shopee.co.id': 'shopping', 'shopee.ph': 'shopping',
  'shopee.tw': 'shopping', 'shopee.vn': 'shopping', 'shopee.com.br': 'shopping',
  'lazada.sg': 'shopping', 'lazada.com.my': 'shopping', 'lazada.co.id': 'shopping', 'lazada.com.ph': 'shopping',
  'aliexpress.com': 'shopping', 'ebay.com': 'shopping', 'ebay.co.uk': 'shopping', 'ebay.de': 'shopping',
  'etsy.com': 'shopping', 'walmart.com': 'shopping', 'target.com': 'shopping', 'bestbuy.com': 'shopping',
  'newegg.com': 'shopping', 'flipkart.com': 'shopping', 'myntra.com': 'shopping',
  'taobao.com': 'shopping', 'tmall.com': 'shopping', 'jd.com': 'shopping', 'rakuten.com': 'shopping',
  'wayfair.com': 'shopping', 'ikea.com': 'shopping', 'sephora.com': 'shopping', 'asos.com': 'shopping',
  'zalando.de': 'shopping', 'temu.com': 'shopping', 'shein.com': 'shopping', 'carousell.sg': 'shopping',
  'mercari.com': 'shopping', 'qoo10.sg': 'shopping', 'uniqlo.com': 'shopping', 'zara.com': 'shopping',
  // Entertainment
  'youtube.com': 'entertainment', 'm.youtube.com': 'entertainment', 'music.youtube.com': 'entertainment',
  'netflix.com': 'entertainment', 'hulu.com': 'entertainment', 'disneyplus.com': 'entertainment',
  'primevideo.com': 'entertainment', 'max.com': 'entertainment', 'hbomax.com': 'entertainment',
  'spotify.com': 'entertainment', 'open.spotify.com': 'entertainment', 'tidal.com': 'entertainment',
  'soundcloud.com': 'entertainment', 'twitch.tv': 'entertainment', 'bilibili.com': 'entertainment',
  'iqiyi.com': 'entertainment', 'vimeo.com': 'entertainment', 'dailymotion.com': 'entertainment',
  'crunchyroll.com': 'entertainment', 'hotstar.com': 'entertainment', 'peacocktv.com': 'entertainment',
  'paramountplus.com': 'entertainment', '9gag.com': 'entertainment', 'steampowered.com': 'entertainment',
  'store.steampowered.com': 'entertainment', 'epicgames.com': 'entertainment', 'roblox.com': 'entertainment',
  'chess.com': 'entertainment', 'itch.io': 'entertainment', 'pokerstars': 'entertainment',
  // News
  'nytimes.com': 'news', 'cnn.com': 'news', 'bbc.com': 'news', 'bbc.co.uk': 'news',
  'theguardian.com': 'news', 'reuters.com': 'news', 'apnews.com': 'news', 'bloomberg.com': 'news',
  'wsj.com': 'news', 'washingtonpost.com': 'news', 'aljazeera.com': 'news', 'cnbc.com': 'news',
  'straitstimes.com': 'news', 'channelnewsasia.com': 'news', 'theverge.com': 'news',
  'techcrunch.com': 'news', 'engadget.com': 'news', 'arstechnica.com': 'news', 'wired.com': 'news',
  'axios.com': 'news', 'politico.com': 'news', 'foxnews.com': 'news', 'nbcnews.com': 'news',
  'cbsnews.com': 'news', 'abcnews.go.com': 'news', 'news.google.com': 'news',
  'news.ycombinator.com': 'news', 'medium.com': 'news', 'substack.com': 'news',
  'zdnet.com': 'news', 'economist.com': 'news', 'ft.com': 'news', 'zaobao.com.sg': 'news',
  // Research
  'arxiv.org': 'research', 'scholar.google.com': 'research', 'researchgate.net': 'research',
  'sciencedirect.com': 'research', 'springer.com': 'research', 'link.springer.com': 'research',
  'nature.com': 'research', 'ieee.org': 'research', 'ieeexplore.ieee.org': 'research',
  'dl.acm.org': 'research', 'acm.org': 'research', 'jstor.org': 'research',
  'semanticscholar.org': 'research', 'pubmed.ncbi.nlm.nih.gov': 'research', 'ncbi.nlm.nih.gov': 'research',
  'ssrn.com': 'research', 'doi.org': 'research', 'plos.org': 'research', 'journals.plos.org': 'research',
  'coursera.org': 'research', 'edx.org': 'research', 'udemy.com': 'research', 'khanacademy.org': 'research',
  'wikipedia.org': 'research', 'en.wikipedia.org': 'research', 'kaggle.com': 'research',
  // Social
  'facebook.com': 'social', 'instagram.com': 'social', 'twitter.com': 'social', 'x.com': 'social',
  'reddit.com': 'social', 'old.reddit.com': 'social', 'tiktok.com': 'social', 'threads.net': 'social',
  'discord.com': 'social', 'ptb.discord.com': 'social', 'whatsapp.com': 'social', 'web.whatsapp.com': 'social',
  'telegram.org': 'social', 'web.telegram.org': 'social', 'snapchat.com': 'social',
  'pinterest.com': 'social', 'quora.com': 'social', 'weibo.com': 'social', 'messenger.com': 'social',
  // Finance
  'coinbase.com': 'finance', 'binance.com': 'finance', 'kraken.com': 'finance', 'robinhood.com': 'finance',
  'schwab.com': 'finance', 'fidelity.com': 'finance', 'vanguard.com': 'finance', 'etrade.com': 'finance',
  'investing.com': 'finance', 'finance.yahoo.com': 'finance', 'tradingview.com': 'finance',
  'stripe.com': 'finance', 'paypal.com': 'finance', 'wise.com': 'finance', 'revolut.com': 'finance',
  'xero.com': 'finance', 'quickbooks.intuit.com': 'finance', 'mint.intuit.com': 'finance',
  'dbs.com': 'finance', 'ocbc.com': 'finance', 'uat.dbs.com': 'finance', 'maybank2u.com.my': 'finance'
};

/* ------------------------------ keywords ------------------------------ */

const K = {
  work: ['inbox', 'gmail', 'google docs', 'google sheets', 'google slides', 'google drive', 'meeting', 'calendar',
    'standup', '1:1', 'weekly', 'roadmap', 'sprint', 'jira', 'confluence', 'notion', 'slack', 'teams', 'zoom',
    'invite', 'proposal', 'project', 'task board', 'okr', 'kpi', 'resume', 'cover letter', 'interview', 'shared drive'],
  development: ['github', 'gitlab', 'pull request', 'merge request', 'stack overflow', 'mdn', 'documentation',
    'reference', 'api', 'sdk', 'cli', 'npm', 'error', 'exception', 'stack trace', 'typescript', 'javascript',
    'python', 'rust', 'golang', 'chrome extension', 'manifest', 'regex', 'sql', 'docker', 'kubernetes', 'deploy',
    'release notes', 'changelog', 'localhost', 'compiler', 'debug'],
  shopping: ['cart', 'checkout', 'add to cart', 'price', 'deal', 'coupon', 'order', 'shipping', 'sale', 'buy now',
    'product', 'discount', 'in stock', 'free delivery'],
  entertainment: ['watch', 'episode', 'trailer', 'playlist', 'movie', 'season', 'stream', 'twitch', 'spotify',
    'album', 'song', 'series', 'trailer', 'gameplay', 'walkthrough'],
  news: ['news', 'breaking', 'headline', 'latest', 'opinion', 'editorial', 'reported', 'analysis:', 'live updates'],
  research: ['arxiv', 'paper', 'journal', 'proceedings', 'abstract', 'et al', 'citation', 'doi', 'thesis',
    'dataset', 'experiment', 'survey', 'lecture notes', 'course'],
  social: ['facebook', 'instagram', 'reddit', 'r/', 'tiktok', 'thread', 'timeline', 'feed', 'profile', 'discord',
    'whatsapp', 'pinterest', 'hashtags'],
  finance: ['portfolio', 'stock', 'crypto', 'bitcoin', 'ethereum', 'wallet', 'bank', 'trading', 'market',
    'nasdaq', 'dividend', 'invoice', 'expenses', 'budget', 'tax return']
};

const SEARCH_QUERY_HOSTS = new Set([
  'google.com', 'www.google.com', 'bing.com', 'duckduckgo.com', 'search.brave.com',
  'search.yahoo.com', 'ecosia.org', 'startpage.com'
]);

function extractSearchQuery(url, host) {
  try {
    if (!SEARCH_QUERY_HOSTS.has(host)) return '';
    const u = new URL(url);
    return (u.searchParams.get('q') || u.searchParams.get('text') || '').toLowerCase();
  } catch {
    return '';
  }
}

/* ------------------------------ scoring ------------------------------ */

const W = {
  USER_RULE: 100,
  HOST_EXACT: 8,
  HOST_SUFFIX: 6,
  TITLE_KW: 2,
  TITLE_CAP: 6,
  URL_KW: 1.2,
  URL_CAP: 3.6,
  QUERY_KW: 1.5,
  QUERY_CAP: 6,
  DOCS_BONUS: 2
};

const CONFIDENCE = {
  high: { min: 12, margin: 4 },
  medium: { min: 6, margin: 2 },
  low: { min: 3, margin: 1 }
};

const CONFIDENCE_ORDER = { unsorted: 0, low: 1, medium: 2, high: 3 };

function matchDomain(rules, host) {
  if (!host) return null;
  if (rules[host]) return { id: rules[host], exact: true };
  for (const [key, id] of Object.entries(rules)) {
    if (host.endsWith('.' + key)) return { id, exact: false };
  }
  return null;
}

/**
 * Score one tab. Pure — safe for unit tests.
 * @returns {{categoryId: string|null, confidence: 'high'|'medium'|'low'|'unsorted', reasons: string[]}}
 */
export function scoreTab(tab, { userRules = {} } = {}) {
  const url = tab.url || '';
  const host = hostOf(url);
  if (!isHttpUrl(url) || !host) {
    return { categoryId: null, confidence: 'unsorted', reasons: [] };
  }
  const title = (tab.title || '').toLowerCase();
  const path = urlPathOf(url);
  const query = extractSearchQuery(url, host);

  // 1) User rules are decisive.
  const userRule = matchDomain(userRules, host);
  if (userRule && CATEGORY_MAP.has(userRule.id)) {
    return { categoryId: userRule.id, confidence: 'high', reasons: [`your rule: ${host}`] };
  }

  const scores = {};
  const marks = {}; // categoryId -> reason strings
  for (const c of CATEGORIES) {
    scores[c.id] = 0;
    marks[c.id] = [];
  }

  // 2) Default domain map.
  const defRule = matchDomain(DEFAULT_DOMAIN_RULES, host);
  if (defRule && CATEGORY_MAP.has(defRule.id)) {
    scores[defRule.id] += defRule.exact ? W.HOST_EXACT : W.HOST_SUFFIX;
    marks[defRule.id].push(defRule.exact ? host : `${host} (${defRule.id} domain)`);
  }

  // 3) Keywords.
  for (const c of CATEGORIES) {
    const kws = K[c.id] || [];
    let tScore = 0, uScore = 0;
    for (const kw of kws) {
      if (title.includes(kw) && tScore < W.TITLE_CAP) { tScore += W.TITLE_KW; marks[c.id].push(`"${kw}" in title`); }
      if (path.includes(kw) && uScore < W.URL_CAP) { uScore += W.URL_KW; marks[c.id].push(`"${kw}" in URL`); }
    }
    scores[c.id] += Math.min(tScore, W.TITLE_CAP) + Math.min(uScore, W.URL_CAP);
  }

  // Docs heuristic (helps vendor docs sites that are not in the map).
  if (/^docs?\./.test(host) || path.startsWith('/docs') || title.includes('documentation')) {
    scores.development += W.DOCS_BONUS;
    marks.development.push('documentation site');
  }

  // 4) Search query words.
  if (query) {
    const words = query.split(/[^a-z0-9]+/).filter((w) => w.length > 2);
    for (const c of CATEGORIES) {
      const kws = new Set(K[c.id] || []);
      let qScore = 0;
      for (const w of words) {
        if (kws.has(w) && qScore < W.QUERY_CAP) { qScore += W.QUERY_KW; marks[c.id].push(`search "${query}"`); }
      }
      scores[c.id] += qScore;
    }
  }

  let best = null, second = null;
  for (const c of CATEGORIES) {
    if (best === null || scores[c.id] > scores[best]) {
      second = best;
      best = c.id;
    } else if (second === null || scores[c.id] > scores[second]) {
      second = c.id;
    }
  }

  const top = best ? scores[best] : 0;
  const sec = second ? scores[second] : 0;
  if (top <= 0 || !best) {
    return { categoryId: null, confidence: 'unsorted', reasons: [] };
  }

  const margin = top - sec;
  let confidence = 'unsorted';
  if (top >= CONFIDENCE.high.min && margin >= CONFIDENCE.high.margin) confidence = 'high';
  else if (top >= CONFIDENCE.medium.min && margin >= CONFIDENCE.medium.margin) confidence = 'medium';
  else if (top >= CONFIDENCE.low.min && margin >= CONFIDENCE.low.margin) confidence = 'low';

  const reasons = (marks[best] || []).slice(0, 3);
  return { categoryId: best, confidence, reasons };
}

/**
 * Classify a batch of tabs (pure).
 * @param {Array} tabs chrome.tabs.Tab-like objects
 * @param {{minConfidence?: string, userRules?: object}} opts
 */
export function classifyTabs(tabs, { minConfidence = 'medium', userRules = {} } = {}) {
  const minRank = CONFIDENCE_ORDER[minConfidence] ?? CONFIDENCE_ORDER.medium;
  const assignments = new Map();
  for (const tab of tabs) {
    const r = scoreTab(tab, { userRules });
    if (r.categoryId && CONFIDENCE_ORDER[r.confidence] >= minRank) {
      assignments.set(tab.id, r);
    } else if (r.categoryId && r.confidence !== 'unsorted') {
      assignments.set(tab.id, { categoryId: null, confidence: r.confidence, reasons: r.reasons, belowThreshold: true });
    } else {
      assignments.set(tab.id, { categoryId: null, confidence: 'unsorted', reasons: [] });
    }
  }
  return assignments;
}

/**
 * Build suggestions from tabs (pure).
 * @param {Array} tabs
 * @param {object} settings
 * @param {Map<number, {title:string, color:string}>} groupsMap existing Chrome tab groups
 * @returns {{suggestions: Array, unsorted: object, existingGroups: Array, stats: object}}
 */
export function analyzeTabs(tabs, settings = {}, groupsMap = new Map()) {
  const preserve = settings.preserveExistingGroups !== false;
  const minGroupSize = Math.max(1, settings.minGroupSize ?? 2);
  const userRules = settings.domainRules || {};
  const hidden = new Set(settings.hiddenCategories || []);

  const candidates = [];
  const existingByGroup = new Map();
  for (const t of tabs) {
    if (isIgnorableUrl(t.url)) continue;
    const ownPage = typeof t.ownExtensionPage === 'boolean' ? t.ownExtensionPage : false;
    if (ownPage) continue;
    if (preserve && t.groupId && t.groupId !== -1) {
      if (!existingByGroup.has(t.groupId)) existingByGroup.set(t.groupId, []);
      existingByGroup.get(t.groupId).push(t);
      continue;
    }
    candidates.push(t);
  }

  const assignments = classifyTabs(candidates, {
    minConfidence: settings.minConfidence || 'medium',
    userRules
  });

  const byCategory = new Map();
  const unsortedTabs = [];
  for (const t of candidates) {
    const a = assignments.get(t.id) || { categoryId: null, confidence: 'unsorted', reasons: [] };
    t._cls = a;
    // Hidden categories behave as unsorted — user removed them from suggestions.
    if (a.categoryId && hidden.has(a.categoryId)) {
      unsortedTabs.push(t);
      continue;
    }
    if (a.categoryId) {
      if (!byCategory.has(a.categoryId)) byCategory.set(a.categoryId, []);
      byCategory.get(a.categoryId).push(t);
    } else {
      unsortedTabs.push(t);
    }
  }

  const suggestions = [];
  for (const [catId, catTabs] of byCategory) {
    const cat = CATEGORY_MAP.get(catId);
    const confRank = Math.max(...catTabs.map((t) => CONFIDENCE_ORDER[t._cls.confidence] ?? 0));
    if (catTabs.length < minGroupSize) {
      unsortedTabs.push(...catTabs);
      continue;
    }
    suggestions.push({
      id: catId,
      kind: 'category',
      categoryId: catId,
      name: (settings.categoryNames && settings.categoryNames[catId]) || cat.name,
      emoji: (settings.categoryEmojis && settings.categoryEmojis[catId]) || cat.emoji,
      color: cat.color,
      hint: cat.hint,
      tabs: catTabs,
      tabIds: catTabs.map((t) => t.id),
      confidence: Object.keys(CONFIDENCE_ORDER).find((k) => CONFIDENCE_ORDER[k] === confRank) || 'medium'
    });
  }
  suggestions.sort((a, b) => b.tabs.length - a.tabs.length);

  const existingGroups = [];
  for (const [groupId, groupTabs] of existingByGroup) {
    const g = groupsMap.get(groupId) || { title: 'Group', color: 'grey' };
    existingGroups.push({ id: groupId, title: g.title || 'Group', color: g.color || 'grey', tabs: groupTabs, count: groupTabs.length });
  }
  existingGroups.sort((a, b) => b.count - a.count);

  const categorized = suggestions.reduce((n, s) => n + s.tabs.length, 0);
  return {
    suggestions,
    unsorted: {
      id: 'unsorted',
      kind: 'unsorted',
      name: UNSORTED.name,
      emoji: UNSORTED.emoji,
      color: null,
      tabs: unsortedTabs,
      tabIds: unsortedTabs.map((t) => t.id)
    },
    existingGroups,
    stats: { total: tabs.length, categorized, unsorted: unsortedTabs.length, suggestions: suggestions.length }
  };
}

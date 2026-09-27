// Small dependency-free helpers shared by core logic and UI.

const TRACKING_PARAM_RE =
  /^(utm_[a-z]+|fbclid|gclid|msclkid|dclid|mc_cid|mc_eid|igshid|si|spm|scid|yclid|_hsenc|_hsmi|vero_id|wickedid|ttclid|ref|ref_src|ref_url|cmpid|cid|igsh|app)$/i;

/** Strip tracking params, hash, trailing slash and www. — used for duplicate matching. */
export function normalizeUrl(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      return url.split('#')[0].toLowerCase();
    }
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    const keep = new URLSearchParams();
    for (const [k, v] of u.searchParams) {
      if (!TRACKING_PARAM_RE.test(k)) keep.set(k, v);
    }
    const path = u.pathname.replace(/\/+$/, '') || '/';
    const qs = keep.toString();
    return `${u.protocol}//${host}${path}${qs ? '?' + qs : ''}`;
  } catch {
    return String(url).split('#')[0].toLowerCase();
  }
}

/** Hostname without leading www., or '' when the URL cannot be parsed. */
export function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

/** Base path + query of a URL, lowercased — used for keyword matching. */
export function urlPathOf(url) {
  try {
    const u = new URL(url);
    return (u.pathname + '?' + u.search).toLowerCase();
  } catch {
    return '';
  }
}

export function isHttpUrl(url) {
  return /^https?:\/\//i.test(url || '');
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function debounce(fn, ms = 300) {
  let t = null;
  const wrapped = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  wrapped.cancel = () => clearTimeout(t);
  return wrapped;
}

export function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

export function uid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

/** Tiny deterministic string hash — used for tab-set fingerprints. */
export function djb2(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export function relativeTime(ts) {
  if (!ts) return 'never';
  const d = Date.now() - ts;
  const M = 60_000, H = 3_600_000, D = 86_400_000;
  if (d < M) return 'just now';
  if (d < H) return `${Math.max(1, Math.floor(d / M))} min ago`;
  if (d < D) { const n = Math.floor(d / H); return n === 1 ? '1 hour ago' : `${n} hours ago`; }
  if (d < 7 * D) { const n = Math.floor(d / D); return n === 1 ? 'yesterday' : `${n} days ago`; }
  return new Date(ts).toLocaleDateString();
}

export function timeOfDay(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function dayLabel(ts) {
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (ts >= startToday) return 'Today';
  if (ts >= startToday - D) return 'Yesterday';
  return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' });
}
const D = 86_400_000;

export function formatCount(n) {
  return new Intl.NumberFormat().format(n);
}

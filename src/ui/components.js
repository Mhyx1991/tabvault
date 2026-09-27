// Shared UI toolkit for the dashboard and popup.
// No frameworks, no inline handlers (MV3 CSP), everything keyboard-accessible.

import { GROUP_COLOR_HEX, LIMITS } from '../shared/constants.js';
import { relativeTime } from '../shared/utils.js';
import { friendly } from '../core/errors.js';

/* ------------------------------ element helper ------------------------------ */

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v; // trusted static markup only
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'checked') node.checked = !!v;
    else if (k === 'disabled') node.disabled = !!v;
    else if (k === 'hidden') node.hidden = !!v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  appendChildren(node, children);
  return node;
}

function appendChildren(node, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) appendChildren(node, c);
    else if (c instanceof Node) node.appendChild(c);
    else node.appendChild(document.createTextNode(String(c)));
  }
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/* --------------------------------- icons --------------------------------- */

const ICONS = {
  search: '<path d="M21 21l-4.35-4.35"/><circle cx="11" cy="11" r="7"/>',
  shield: '<path d="M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6l7-3z"/><path d="M9.5 12l2 2 3.5-4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  folder: '<path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 016 6v0a6 6 0 01-6 6h-3"/>',
  download: '<path d="M12 3v12m0 0l-4-4m4 4l4-4"/><path d="M4 21h16"/>',
  upload: '<path d="M12 21V9m0 0l-4 4m4-4l4 4"/><path d="M4 3h16"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13a1 1 0 001 1h8a1 1 0 001-1l1-13M9 7V4h6v3"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/>',
  pin: '<path d="M12 17v5"/><path d="M9 3h6l-1 7 3 3H7l3-3-1-7z"/>',
  external: '<path d="M14 4h6v6"/><path d="M20 4L10 14"/><path d="M18 13v6a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h6"/>',
  check: '<path d="M5 13l4 4L19 7"/>',
  alert: '<path d="M12 9v4m0 4h.01"/><path d="M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"/>',
  dots: '<circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 012-2h10"/>',
  refresh: '<path d="M21 12a9 9 0 11-2.6-6.3"/><path d="M21 3v6h-6"/>',
  camera: '<rect x="3" y="7" width="18" height="13" rx="2"/><circle cx="12" cy="13" r="4"/><path d="M8 7l1.5-3h5L16 7"/>'
};

export function icon(name, size = 18) {
  return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

/* ---------------------------------- badge ---------------------------------- */

export function badge(text, tone = 'muted', title) {
  return el('span', { class: `badge badge-${tone}`, text, title: title || undefined });
}

export function groupDot(color) {
  const hex = GROUP_COLOR_HEX[color] || '#8e9297';
  return el('span', { class: 'group-dot', style: `background:${hex}`, title: `${color} group` });
}

/* --------------------------------- favicon --------------------------------- */

export function faviconEl(url, { size = 16 } = {}) {
  let src = '';
  try {
    src = chrome.runtime.getURL('/_favicon/') + '?pageUrl=' + encodeURIComponent(url) + '&size=32';
  } catch { src = ''; }
  const img = el('img', { class: 'fav', src, width: size, height: size, alt: '' });
  img.addEventListener('error', () => {
    const fallback = el('span', { class: 'fav fav-letter', style: `width:${size}px;height:${size}px;line-height:${size}px`, 'aria-hidden': 'true' });
    let host = '';
    try { host = new URL(url).hostname.replace(/^www\./, ''); } catch {}
    fallback.textContent = (host || '?').charAt(0).toUpperCase();
    img.replaceWith(fallback);
  });
  return img;
}

/* ---------------------------------- toasts --------------------------------- */

let toastContainer = null;
function ensureToasts() {
  if (!toastContainer) {
    toastContainer = el('div', { class: 'toasts', 'aria-live': 'polite' });
    document.body.appendChild(toastContainer);
  }
  return toastContainer;
}

export function toast(message, { type = 'info', actionLabel = null, onAction = null, timeout = 6000 } = {}) {
  const host = ensureToasts();
  const t = el('div', { class: `toast toast-${type}`, role: 'status' },
    el('span', { class: 'toast-msg', text: message }),
    actionLabel ? el('button', { class: 'btn btn-ghost btn-sm toast-action', text: actionLabel, onclick: () => { onAction?.(); dismiss(); } }) : null,
    el('button', { class: 'icon-btn toast-close', 'aria-label': 'Dismiss', html: icon('x', 14), onclick: () => dismiss() })
  );
  function dismiss() {
    t.classList.add('toast-out');
    setTimeout(() => t.remove(), 180);
  }
  host.appendChild(t);
  if (timeout) setTimeout(dismiss, timeout);
  return dismiss;
}

/* ---------------------------------- modals --------------------------------- */

export function openModal({ title, body, footer, wide = false, onClose = null }) {
  const dlg = el('dialog', { class: 'modal' + (wide ? ' modal-wide' : '') });
  const bodyEl = el('div', { class: 'modal-body' });
  if (body) bodyEl.append(body);
  const footerEl = el('div', { class: 'modal-footer' });
  if (footer) footerEl.append(footer);
  dlg.append(
    el('header', { class: 'modal-head' },
      el('h2', { class: 'modal-title', text: title || '' }),
      el('button', { class: 'icon-btn', 'aria-label': 'Close dialog', html: icon('x', 16), onclick: () => api.close() })
    ),
    bodyEl,
    ...(footer ? [footerEl] : [])
  );
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); api.close(); });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) api.close(); });
  document.body.appendChild(dlg);
  const api = {
    dialog: dlg, body: bodyEl, footer: footerEl,
    close() {
      try { dlg.close(); } catch {}
      dlg.remove();
      onClose?.();
    }
  };
  dlg.showModal();
  const focusable = dlg.querySelector('input, select, textarea, button:not(.modal-close-default)');
  (dlg.querySelector('[data-autofocus]') || focusable || dlg.querySelector('button'))?.focus();
  return api;
}

export function confirmDialog({ title, message, html = null, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false, checkbox = null, detail = null }) {
  return new Promise((resolve) => {
    let checked = false;
    let settled = false;
    const body = el('div', {},
      message ? el('p', { class: 'modal-text', text: message }) : null,
      html || null,
      detail || null,
      checkbox ? el('label', { class: 'check-row' },
        el('input', { type: 'checkbox', onchange: (e) => { checked = e.target.checked; } }),
        el('span', { text: checkbox })
      ) : null
    );
    const footer = el('div', { class: 'btn-row end' },
      el('button', { class: 'btn btn-secondary', text: cancelLabel, onclick: () => done(false) }),
      el('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, text: confirmLabel, 'data-autofocus': true, onclick: () => done(true) })
    );
    const m = openModal({
      title,
      body,
      footer,
      onClose: () => { if (!settled) { settled = true; resolve({ ok: false, checked: false }); } }
    });
    function done(ok) {
      settled = true;
      resolve({ ok, checked });
      m.close();
    }
  });
}

export function promptDialog({ title, label, value = '', placeholder = '', confirmLabel = 'Save' }) {
  return new Promise((resolve) => {
    let settled = false;
    const input = el('input', { class: 'input', type: 'text', value, placeholder, maxlength: '80', 'data-autofocus': true, 'aria-label': label });
    const form = el('form', { class: 'modal-text' },
      el('label', { class: 'field-label', text: label }),
      input
    );
    form.addEventListener('submit', (e) => { e.preventDefault(); if (input.value.trim()) done(input.value.trim()); });
    const footer = el('div', { class: 'btn-row end' },
      el('button', { class: 'btn btn-secondary', type: 'button', text: 'Cancel', onclick: () => done(null) }),
      el('button', { class: 'btn btn-primary', type: 'submit', text: confirmLabel })
    );
    const m = openModal({
      title,
      body: form,
      footer,
      onClose: () => { if (!settled) { settled = true; resolve(null); } }
    });
    function done(v) { settled = true; resolve(v); m.close(); }
  });
}

/* -------------------------------- dropdown --------------------------------- */

let openMenuCleanup = null;
function closeOpenMenu() {
  if (openMenuCleanup) { openMenuCleanup(); openMenuCleanup = null; }
}

/**
 * A ⋯ button that opens a dropdown menu.
 * items: [{label, value, danger?, disabled?, separator?, icon?}]
 */
export function menuBtn({ items, onPick, ariaLabel = 'More options', iconHtml = null }) {
  const wrap = el('div', { class: 'menu-wrap' });
  const btn = el('button', { class: 'icon-btn', 'aria-label': ariaLabel, 'aria-haspopup': 'menu', html: iconHtml || icon('dots', 16) });
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (wrap.querySelector('.menu')) { closeOpenMenu(); return; }
    openMenu();
  });
  function openMenu() {
    closeOpenMenu();
    const menu = el('div', { class: 'menu', role: 'menu' });
    for (const item of items) {
      if (item.separator) { menu.appendChild(el('div', { class: 'menu-sep' })); continue; }
      const b = el('button', {
        class: 'menu-item' + (item.danger ? ' danger' : ''),
        role: 'menuitem', text: item.label, disabled: !!item.disabled
      });
      b.addEventListener('click', () => {
        closeOpenMenu();
        onPick?.(item.value, item);
      });
      menu.appendChild(b);
    }
    wrap.appendChild(menu);
    const close = () => {
      menu.remove();
      document.removeEventListener('click', close);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', close);
      openMenuCleanup = null;
    };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', close);
    openMenuCleanup = close;
    // Keep the menu on screen.
    const r = btn.getBoundingClientRect();
    const mw = LIMITS.MENU_WIDTH;
    menu.style.minWidth = mw + 'px';
    const rightSpace = window.innerWidth - r.right;
    if (rightSpace < mw + 8) { menu.style.right = '0'; menu.style.left = 'auto'; }
    else { menu.style.left = '0'; menu.style.right = 'auto'; }
    const below = window.innerHeight - r.bottom;
    if (below < 200 && r.top > 220) { menu.style.bottom = (r.height + 6) + 'px'; menu.style.top = 'auto'; }
    else { menu.style.top = (r.height + 6) + 'px'; menu.style.bottom = 'auto'; }
  }
  wrap.appendChild(btn);
  return wrap;
}

/* --------------------------------- tab row --------------------------------- */

/**
 * One row representing a tab.
 * opts: { selectable, selected, onToggle, onOpen, menu:[{label,value,...}], reason, chips:[] }
 */
export function tabRow(tab, opts = {}) {
  const row = el('div', { class: 'tab-row' });
  if (opts.selectable) {
    const cb = el('input', { type: 'checkbox', class: 'tab-check', 'aria-label': `Select ${tab.title || tab.url}` });
    cb.checked = !!opts.selected;
    cb.addEventListener('change', () => opts.onToggle?.(tab.id, cb.checked));
    row.appendChild(cb);
  }
  row.appendChild(faviconEl(tab.url));

  const main = el('div', { class: 'tab-main' });
  main.appendChild(el('span', { class: 'tab-title', title: tab.title || tab.url, text: tab.title || tab.url || 'Untitled' }));
  const subline = el('div', { class: 'tab-subline' });
  subline.appendChild(el('span', { class: 'tab-host', text: tab.host || hostOf(tab.url) }));
  if (opts.reason) subline.appendChild(el('span', { class: 'tab-reason', text: '· ' + opts.reason }));
  if (tab.pinned) subline.appendChild(badge('Pinned', 'muted'));
  if (tab.discarded) subline.appendChild(badge('Sleeping', 'muted'));
  for (const chip of opts.chips || []) subline.appendChild(chip);
  main.appendChild(subline);
  row.appendChild(main);

  if (opts.meta) row.appendChild(el('span', { class: 'tab-meta', text: opts.meta }));

  if (opts.menu?.length) {
    row.appendChild(menuBtn({
      ariaLabel: `Options for ${tab.title || tab.url}`,
      items: opts.menu,
      onPick: (value) => opts.onMenu?.(value, tab)
    }));
  }

  row.addEventListener('click', (e) => {
    if (e.target?.closest?.('button, input, select, a')) return;
    opts.onOpen?.(tab);
  });
  return row;
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

/* ------------------------------- misc helpers ------------------------------ */

export function sectionHead(title, ...actions) {
  return el('div', { class: 'section-head' },
    el('h2', { class: 'section-title', text: title }),
    actions.length ? el('div', { class: 'btn-row' }, ...actions) : null
  );
}

export function card(classNames = '') {
  return el('div', { class: 'card' + (classNames ? ' ' + classNames : '') });
}

export function emptyState({ iconName = 'check', title, text, actions = [] }) {
  return el('div', { class: 'empty' },
    el('div', { class: 'empty-icon', html: icon(iconName, 28) }),
    el('h3', { class: 'empty-title', text: title }),
    text ? el('p', { class: 'empty-text', text }) : null,
    actions.length ? el('div', { class: 'btn-row center' }, ...actions) : null
  );
}

/** Render a long list with a "Show more" expansion. */
export function limitedList(container, items, makeRow, { limit = LIMITS.LIST_RENDER } = {}) {
  const frag = document.createDocumentFragment();
  items.slice(0, limit).forEach((item, i) => frag.appendChild(makeRow(item, i)));
  container.appendChild(frag);
  if (items.length > limit) {
    let shown = limit;
    const btn = el('button', { class: 'btn btn-ghost btn-block', text: `Show all ${items.length}` });
    btn.addEventListener('click', () => {
      const next = items.slice(shown, shown + 300);
      const f = document.createDocumentFragment();
      next.forEach((item, i) => f.appendChild(makeRow(item, shown + i)));
      container.insertBefore(f, btn);
      shown += next.length;
      if (shown >= items.length) btn.remove();
      else btn.textContent = `Show more (${items.length - shown} left)`;
    });
    container.appendChild(btn);
  }
}

/** Trigger a client-side file download (no network). */
export function downloadText(filename, mime, content) {
  const blob = new Blob([content], { type: mime + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function rel(ts) {
  return relativeTime(ts);
}

/**
 * Small ✕ button for closing a tab directly from a row (search results,
 * suggestion lists). Shows an Undo-style toast so an accidental click is
 * recoverable via Ctrl+Shift+T or the toast action.
 */
export function closeTabBtn(tab, { onClosed = null } = {}) {
  const btn = el('button', {
    class: 'icon-btn tab-close-btn',
    'aria-label': `Close ${tab.title || tab.url || 'tab'}`,
    title: 'Close tab',
    html: icon('x', 14)
  });
  btn.addEventListener('click', async (e) => {
    e.stopPropagation(); // don't trigger the row's activate-tab click
    try {
      await chrome.tabs.remove(tab.id);
      if (onClosed) onClosed(tab);
    } catch (err) {
      // Tab may already be gone (closed elsewhere) — surface other failures.
      if (!/No tab with id/i.test(String(err?.message || err))) {
        toast(friendly(err), { type: 'error' });
      }
    }
  });
  return btn;
}

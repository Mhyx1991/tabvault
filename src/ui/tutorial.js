// First-run tutorial: THREE steps, skippable at every point, shown once.
// Covers only the main features a newcomer needs on day one:
//   1. Organize  — the core action (hero button on the dashboard)
//   2. Undo + Stash — nothing is ever lost; the panic button
//   3. Cleanup — duplicates and same-site clusters
//
// UX rules (from the QA personas):
//  - Skip is always visible and needs no confirmation
//  - Highlights the REAL UI element when possible; falls back to a plain
//    centered card when the element isn't on screen
//  - Never blocks the app: one small overlay, removed instantly on finish
//  - Shown ONCE after onboarding (settings.tutorialDone), never again

import { el, clear } from './components.js';
import { updateSettings } from './store.js';

const STEPS = [
  {
    title: '1 of 3 — Organize your tabs',
    body: 'TabVault reads your open tabs and suggests groups like Work, Development or Shopping. One click groups them using Chrome’s native tab groups.',
    targetSelector: '.hero-actions .btn-primary',
    fallbackIcon: '🗂️'
  },
  {
    title: '2 of 3 — Nothing is ever lost',
    body: 'Every change saves a snapshot first. Made a mistake? Press Undo to restore the previous layout. Overwhelmed? “Stash all tabs” parks everything safely.',
    targetSelector: '.notice-undo',
    fallbackIcon: '🛟'
  },
  {
    title: '3 of 3 — Tidy up the leftovers',
    body: 'Cleanup finds duplicate tabs and clusters of pages from the same site, so you can close or group them in a couple of clicks.',
    targetSelector: '.nav-item[data-view="care"]',
    fallbackIcon: '🧹'
  }
];

/** Run the tutorial. Resolves when finished or skipped. */
export function startTutorial(ctx) {
  return new Promise((resolve) => {
    let index = 0;
    let overlay = null;

    function cleanup() {
      overlay?.remove();
      overlay = null;
      document.getElementById('tv-tut-highlight')?.remove();
    }

    async function finish(done) {
      cleanup();
      try { await updateSettings({ tutorialDone: true }); } catch { /* non-fatal */ }
      resolve(done);
    }

    function highlight(target) {
      document.getElementById('tv-tut-highlight')?.remove();
      if (!target) return;
      const r = target.getBoundingClientRect();
      const ring = el('div', { id: 'tv-tut-highlight' });
      ring.style.cssText = `position:fixed;z-index:9998;pointer-events:none;border:2px solid var(--accent);border-radius:10px;box-shadow:0 0 0 4px color-mix(in srgb, var(--accent) 25%, transparent);transition:all .25s ease;left:${r.left - 6}px;top:${r.top - 6}px;width:${r.width + 12}px;height:${r.height + 12}px`;
      document.body.appendChild(ring);
    }

    function render() {
      cleanup();
      const step = STEPS[index];
      const target = document.querySelector(step.targetSelector);
      const r = target?.getBoundingClientRect();

      overlay = el('div', { class: 'tv-tut-overlay', role: 'dialog', 'aria-label': 'TabVault tutorial' });
      // dimmer that doesn't block clicks outside the card is complex; we DO
      // block while the tutorial is up (3 steps, seconds long) — Esc skips.
      overlay.addEventListener('click', (e) => { if (e.target === overlay) { /* click outside = advance, like onboarding */ } });

      const card = el('div', { class: 'tv-tut-card' },
        el('div', { class: 'tv-tut-icon', text: step.fallbackIcon }),
        el('h3', { class: 'tv-tut-title', text: step.title }),
        el('p', { class: 'tv-tut-body', text: step.body }),
        el('div', { class: 'tv-tut-actions' },
          el('button', { class: 'btn btn-ghost btn-sm', text: 'Skip tutorial', onclick: () => finish(false) }),
          el('div', { class: 'btn-row' },
            index > 0 ? el('button', { class: 'btn btn-secondary btn-sm', text: 'Back', onclick: () => { index--; render(); } }) : null,
            index < STEPS.length - 1
              ? el('button', { class: 'btn btn-primary', text: 'Next', onclick: () => { index++; render(); } })
              : el('button', { class: 'btn btn-primary', text: "Got it — let's go", onclick: () => finish(true) })
          )
        )
      );

      // Position near the target when there's room; otherwise center.
      overlay.appendChild(card);
      document.body.appendChild(overlay);
      highlight(target);
      if (target && r) {
        const below = window.innerHeight - r.bottom;
        const cardH = 200;
        if (below > cardH + 20) {
          card.style.position = 'fixed';
          card.style.left = Math.max(12, Math.min(window.innerWidth - 340, r.left)) + 'px';
          card.style.top = (r.bottom + 14) + 'px';
        } else if (r.top > cardH + 20) {
          card.style.position = 'fixed';
          card.style.left = Math.max(12, Math.min(window.innerWidth - 340, r.left)) + 'px';
          card.style.top = (r.top - cardH - 14) + 'px';
        }
      }

      // Esc = skip (fast exit, per QA request)
      const onKey = (e) => {
        if (e.key === 'Escape') { document.removeEventListener('keydown', onKey); finish(false); }
        if (e.key === 'Enter' && index < STEPS.length - 1) { index++; render(); }
      };
      document.addEventListener('keydown', onKey);
    }

    render();
  });
}

/** Should the tutorial run? Called once after onboarding completes. */
export function shouldShowTutorial(settings) {
  return !!settings?.onboarded && !settings?.tutorialDone;
}

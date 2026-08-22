// Toast history — the "what did that message say?" surface.
//
// Every toast is recorded in the session log (services/toastLog.js). Clicking a
// toast opens the modal below; Admin → Monitoring renders the same list inline
// through toastLogHtml(), so the two views can never drift apart.

import { t } from '../i18n/i18n.js';
import { escHtml } from '../utils/escHtml.js';
import { getToastLog } from '../services/toastLog.js';

// Types that carry a translated badge + a colour. Anything else falls back to
// the raw type string rather than rendering a missing i18n key.
const KNOWN_TYPES = new Set(['success', 'error', 'info']);

function badgeText(type) {
  return KNOWN_TYPES.has(type) ? t('toast.type.' + type) : type;
}

function timeOf(ts) {
  const d = new Date(ts);
  return isNaN(d.getTime()) ? '' : d.toLocaleTimeString();
}

/** Render log entries (newest first) as a list. Shared by the modal + Monitoring. */
export function toastLogHtml(entries) {
  if (!entries.length) return `<p class="toast-log__empty">${escHtml(t('toast.logEmpty'))}</p>`;
  return `<ul class="toast-log">`
    + entries.map(e => {
      // Entries written before the user stamp existed carry no `user` key — show
      // the signed-out label rather than an empty column.
      const user = e.user || t('toast.userAnonymous');
      return `<li class="toast-log__item toast-log__item--${escHtml(e.type)}">`
        + `<span class="toast-log__time">${escHtml(timeOf(e.ts))}</span>`
        + `<span class="toast-log__user${e.user ? '' : ' is-anon'}">${escHtml(user)}</span>`
        + `<span class="toast-log__badge">${escHtml(badgeText(e.type))}</span>`
        + `<span class="toast-log__msg">${escHtml(e.message)}</span>`
      + `</li>`;
    }).join('')
    + `</ul>`;
}

// ── Modal ─────────────────────────────────────────────────────────────────────
// Mounted once, then reopened — same shape as LoginModal (overlay click, close
// button, Escape). Strings are refreshed on open because the locale can change
// between opens while the overlay stays in the DOM.

let overlay = null;

function mount() {
  overlay = document.createElement('div');
  overlay.className = 'modal-overlay toast-log-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'toast-log-title');
  overlay.innerHTML = `
    <div class="modal toast-log-modal">
      <button class="modal__close" type="button">&times;</button>
      <h2 class="modal__title" id="toast-log-title"></h2>
      <div class="toast-log-modal__body"></div>
    </div>
  `;
  overlay.querySelector('.modal__close').addEventListener('click', () => closeToastLog());
  overlay.addEventListener('click', e => { if (e.target === overlay) closeToastLog(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeToastLog(); });
  document.body.appendChild(overlay);
}

export function openToastLog() {
  const firstOpen = !overlay;
  if (firstOpen) mount();
  overlay.querySelector('#toast-log-title').textContent = t('toast.logTitle');
  overlay.querySelector('.modal__close').setAttribute('aria-label', t('toast.close'));
  overlay.querySelector('.toast-log-modal__body').innerHTML = toastLogHtml(getToastLog());
  // On the very first open the overlay was appended in this same tick, so its
  // opacity:0 start state hasn't been committed yet and the fade-in would be
  // skipped. Force a style flush rather than waiting a frame — requestAnimationFrame
  // never fires in a background tab, which would leave the modal stuck invisible.
  if (firstOpen) void overlay.offsetWidth;
  overlay.classList.add('open');
}

export function closeToastLog() {
  if (overlay) overlay.classList.remove('open');
}

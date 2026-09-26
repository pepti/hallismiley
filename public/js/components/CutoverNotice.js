// CutoverNotice — the time-limited site announcement (Admin → Tilkynning).
// Ported from icelandicstore #200 (harvest2-lane7a-2026-09-26), where it told
// customers carried over from Shopify to set a password; the name is ice's,
// the copy here is the admin's (title, message, an optional in-site link).
//
// Signed-out visitors only, and gone the moment someone signs in. Two shapes:
//   • the FIRST visit gets a dialog — the kit's .modal-overlay/.modal, focus
//     trapped (utils/focusTrap.js), Esc / the backdrop / "Loka" close it;
//   • closing it demotes it to a slim banner above the nav for the rest of
//     the window ("Lesa meira" reopens the dialog, ✕ hides it for good).
// Dismissals are remembered per browser, keyed on the announcement's `id`, so
// a NEW announcement is shown again to someone who closed the last one. Every
// storage access is in try/catch: a private window or blocked storage just
// means the dialog shows once per page load.
//
// No layout shift: the dialog is an overlay (moves nothing). The banner has a
// fixed height, and on a return visit whose stored state says "banner" its
// slot is RESERVED synchronously at boot, before the fetch (reserveSlot), and
// filled when the answer comes — so the page does not jump when it appears.
// The only shift left is the rare one where the slot was reserved and the
// announcement has since ended (the slot collapses once).
//
// The window is decided on the SERVER (GET /api/v1/announcement answers only
// `{ active:false }` outside it); nothing here does date arithmetic.
import { t, href, getLocale } from '../i18n/i18n.js';
import { escHtml } from '../utils/escHtml.js';
import { isAuthenticated } from '../services/auth.js';
import { navigate } from '../navigate.js';
import { trapFocus } from '../utils/focusTrap.js';

const STORE_KEY = 'site_announcement';

function readState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const s = raw ? JSON.parse(raw) : null;
    return s && typeof s === 'object' ? s : null;
  } catch { return null; }
}
function writeState(s) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch { /* private mode / blocked */ }
}

// The visitor's language, else the other one: an admin may write only one.
function pick(perLocale) {
  const o = perLocale || {};
  const loc = getLocale() === 'en' ? 'en' : 'is';
  const other = loc === 'en' ? 'is' : 'en';
  return (o[loc] && o[loc].trim()) || (o[other] && o[other].trim()) || '';
}

export class CutoverNotice {
  /** @param {{ anchor: HTMLElement }} opts  the banner goes right before `anchor` (the nav) */
  constructor({ anchor } = {}) {
    this._anchor = anchor || null;
    this._data = null;
    this._banner = null;
    this._overlay = null;
    this._release = null;
    this._onKey = null;
    this._onAuth = () => { if (isAuthenticated()) this.destroy(); };
    this._onLocale = () => { if (this._banner && this._data) this._fillBanner(); };
  }

  /** Synchronous: reserve the banner's slot when this browser last showed it. */
  reserveSlot() {
    if (isAuthenticated()) return;
    const st = readState();
    if (st && st.modalSeen && !st.bannerHidden) this._ensureBanner(true);
  }

  /** Fire-and-forget: never blocks boot, never throws into it. */
  async start() {
    window.addEventListener('authchange', this._onAuth);
    window.addEventListener('localechange', this._onLocale);
    if (isAuthenticated()) { this._removeBanner(); return; }
    let data = null;
    try {
      const res = await fetch('/api/v1/announcement', { credentials: 'same-origin' });
      if (res.ok) data = await res.json();
    } catch { /* unreachable → no announcement */ }
    if (!data || data.active !== true || !pick(data.title) || isAuthenticated()) {
      this._removeBanner();
      return;
    }
    this._data = data;
    let st = readState();
    if (!st || st.id !== data.id) {
      st = { id: data.id, modalSeen: false, bannerHidden: false };
      writeState(st);
    }
    if (!st.modalSeen) { this._removeBanner(); this._openModal(); }
    else if (!st.bannerHidden) this._fillBanner();
    else this._removeBanner();
  }

  // ── The dialog ─────────────────────────────────────────────────────────────
  _openModal() {
    if (this._overlay) return;
    const d = this._data;
    const message = pick(d.message);
    const linkLabel = d.link ? (pick(d.link.label) || t('announcement.readMore')) : '';
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay announce-overlay';
    overlay.innerHTML = `
      <div class="modal announce-modal" role="dialog" aria-modal="true"
           aria-labelledby="announce-title"${message ? ' aria-describedby="announce-message"' : ''}
           data-testid="announcement-modal">
        <button type="button" class="modal__close" data-close aria-label="${escHtml(t('announcement.close'))}">✕</button>
        <h2 class="modal__title announce-modal__title" id="announce-title">${escHtml(pick(d.title))}</h2>
        ${message ? `<p class="announce-modal__message" id="announce-message">${escHtml(message)}</p>` : ''}
        <div class="announce-modal__actions">
          ${d.link ? `<a class="btn btn--primary" data-link href="${escHtml(href(d.link.path))}">${escHtml(linkLabel)}</a>` : ''}
          <button type="button" class="btn ${d.link ? 'btn--ghost' : 'btn--primary'}" data-ok>${escHtml(t('announcement.close'))}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    this._overlay = overlay;
    void overlay.offsetWidth; // commit opacity:0 so the fade runs (ErrorDialog.js)
    overlay.classList.add('open');

    const dialog = overlay.querySelector('.announce-modal');
    overlay.querySelector('[data-close]').addEventListener('click', () => this._closeModal());
    overlay.querySelector('[data-ok]').addEventListener('click', () => this._closeModal());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) this._closeModal(); });
    overlay.querySelector('[data-link]')?.addEventListener('click', (e) => {
      e.preventDefault();
      this._follow(d.link.path);
    });
    this._onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); this._closeModal(); } };
    document.addEventListener('keydown', this._onKey);
    this._release = trapFocus(dialog, { initial: overlay.querySelector('[data-link]') || overlay.querySelector('[data-ok]') });
  }

  _teardownModal() {
    if (this._onKey) { document.removeEventListener('keydown', this._onKey); this._onKey = null; }
    if (this._release) { const r = this._release; this._release = null; r(); }
    if (this._overlay) { this._overlay.remove(); this._overlay = null; }
  }

  // Closing does not end the campaign — it demotes to the banner, so a visitor
  // who clicked past it still has a way back to it.
  _closeModal() {
    const st = { ...(readState() || {}), id: this._data.id, modalSeen: true };
    writeState(st);
    this._teardownModal();
    if (!st.bannerHidden) this._fillBanner();
  }

  // Following the link is itself an acknowledgement: neither shape comes back.
  _follow(path) {
    writeState({ id: this._data.id, modalSeen: true, bannerHidden: true });
    this.destroy();
    navigate(href(path));
  }

  // ── The banner ─────────────────────────────────────────────────────────────
  _ensureBanner(pending = false) {
    if (this._banner) return this._banner;
    const bar = document.createElement('div');
    bar.className = 'announce-banner' + (pending ? ' announce-banner--pending' : '');
    bar.setAttribute('role', 'region');
    bar.dataset.testid = 'announcement-banner';
    const anchor = this._anchor && this._anchor.parentNode ? this._anchor : document.body.firstChild;
    document.body.insertBefore(bar, anchor);
    this._banner = bar;
    return bar;
  }

  _fillBanner() {
    const bar = this._ensureBanner();
    bar.classList.remove('announce-banner--pending');
    bar.setAttribute('aria-label', t('announcement.region'));
    bar.innerHTML = `
      <p class="announce-banner__text">${escHtml(pick(this._data.title))}</p>
      <button type="button" class="announce-banner__more" data-more>${escHtml(t('announcement.readMore'))}</button>
      <button type="button" class="announce-banner__close" data-hide aria-label="${escHtml(t('announcement.hide'))}">✕</button>`;
    bar.querySelector('[data-more]').addEventListener('click', () => this._openModal());
    bar.querySelector('[data-hide]').addEventListener('click', () => {
      writeState({ ...(readState() || {}), id: this._data.id, modalSeen: true, bannerHidden: true });
      this._removeBanner();
    });
  }

  _removeBanner() {
    if (this._banner) { this._banner.remove(); this._banner = null; }
  }

  destroy() {
    this._teardownModal();
    this._removeBanner();
    window.removeEventListener('authchange', this._onAuth);
    window.removeEventListener('localechange', this._onLocale);
  }
}

/** Boot hook (main.js): reserve the slot now, fetch in the background. */
export function mountCutoverNotice({ anchor } = {}) {
  const notice = new CutoverNotice({ anchor });
  notice.reserveSlot();
  notice.start();
  return notice;
}

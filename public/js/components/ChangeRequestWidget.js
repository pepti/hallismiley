// In-app change-request widget — non-production only (mounted from main.js when
// the app reports a non-prod app-env, and toggled by the theme switcher's TEST
// row). Click an element on any page, write a note, and queue it; queued
// requests persist across SPA navigation in localStorage. "Submit all" sends
// the whole session as one batch to POST /api/v1/change-requests.
import { t, SUPPORTED_LOCALES } from '../i18n/i18n.js';
import { showToast } from './Toast.js';
import { getCSRFToken, getUser } from '../services/auth.js';
import { setDemoMode } from '../services/themePrefs.js';

const BASKET_KEY = 'cr_basket_v1';

const FAB_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
const DEMO_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="1"/><path d="M8 20h8M12 16v4"/></svg>';

// Human-readable page labels, keyed by locale-stripped path (HalliProjects routes).
const PAGE_LABELS = {
  '/': 'Home',
  '/projects': 'Projects',
  '/news': 'News',
  '/halli': 'About',
  '/about': 'About',
  '/contact': 'Contact',
  '/shop': 'Shop',
  '/cart': 'Cart',
  '/checkout': 'Checkout',
  '/checkout/success': 'Order confirmation',
  '/orders': 'Order history',
  '/profile': 'Profile',
  '/login': 'Sign in',
  '/signup': 'Sign up',
  '/privacy': 'Privacy',
  '/terms': 'Terms',
  '/party': 'Party',
  '/party/admin': 'Party admin',
  '/admin': 'Admin dashboard',
  '/admin/users': 'Users',
  '/admin/analytics': 'Analytics',
  '/admin/general': 'Settings',
  '/admin/discounts': 'Discounts',
  '/admin/sales': 'Sales report',
  '/admin/background': 'Home background',
  '/admin/feedback': 'Feedback inbox',
  '/admin/shop/products': 'Manage products',
  '/admin/shop/orders': 'Manage orders',
};

function stripLocalePath(pathname) {
  const parts = (pathname || '/').split('/').filter(Boolean);
  if (parts[0] && SUPPORTED_LOCALES.includes(parts[0])) parts.shift();
  return '/' + parts.join('/');
}

function currentPageInfo() {
  const pageUrl = window.location.pathname + window.location.search;
  const bare = stripLocalePath(window.location.pathname).replace(/\/+$/, '') || '/';
  let label = PAGE_LABELS[bare];
  if (!label && bare.startsWith('/shop/'))     label = 'Product detail';
  if (!label && bare.startsWith('/projects/')) label = 'Project detail';
  if (!label && bare.startsWith('/news/'))     label = 'Article';
  if (!label) label = (document.title || bare).slice(0, 80);
  return { page_url: pageUrl, page_label: label };
}

function cssEscape(s) {
  if (window.CSS && typeof CSS.escape === 'function') return CSS.escape(s);
  return String(s).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}

// Build a reasonably stable, reasonably short CSS selector for an element:
// prefer a unique #id, else walk up to <body> with tag.class + :nth-of-type,
// stopping as soon as the accumulated selector is unique. A hint, not a contract.
function buildSelector(el) {
  if (!(el instanceof Element)) return '';
  if (el.id) return `#${cssEscape(el.id)}`;
  const parts = [];
  let node = el;
  let depth = 0;
  while (node && node.nodeType === 1 && node !== document.body && depth < 6) {
    if (node.id) { parts.unshift(`#${cssEscape(node.id)}`); break; }
    let seg = node.tagName.toLowerCase();
    const classes = (typeof node.className === 'string' ? node.className : '')
      .trim().split(/\s+/)
      .filter(c => c && !c.startsWith('is-') && !c.startsWith('cr-') && !c.startsWith('active'))
      .slice(0, 2);
    if (classes.length) seg += '.' + classes.map(cssEscape).join('.');
    const parent = node.parentElement;
    if (parent) {
      const sameTag = Array.from(parent.children).filter(c => c.tagName === node.tagName);
      if (sameTag.length > 1) seg += `:nth-of-type(${sameTag.indexOf(node) + 1})`;
    }
    parts.unshift(seg);
    try { if (document.querySelectorAll(parts.join(' > ')).length === 1) break; } catch { /* ignore */ }
    node = node.parentElement;
    depth++;
  }
  return parts.join(' > ');
}

function labelFor(el) {
  if (!(el instanceof Element)) return '';
  const attrs = ['aria-label', 'alt', 'title', 'placeholder', 'name'];
  for (const a of attrs) {
    const v = el.getAttribute(a);
    if (v && v.trim()) return v.trim().slice(0, 60);
  }
  const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
  if (text) return text.slice(0, 60);
  return `<${el.tagName.toLowerCase()}>`;
}

function loadBasket() {
  try {
    const raw = localStorage.getItem(BASKET_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    if (!data || data.v !== 1 || !Array.isArray(data.items)) return [];
    return data.items.filter(it => it && typeof it.note === 'string');
  } catch {
    return [];
  }
}

function saveBasket(items) {
  const payload = JSON.stringify({ v: 1, items });
  try {
    localStorage.setItem(BASKET_KEY, payload);
  } catch {
    // Most likely quota — screenshots are the heavy part. Retry without them so
    // the notes at least survive a reload (screenshots stay in memory).
    try {
      localStorage.setItem(BASKET_KEY, JSON.stringify({
        v: 1, items: items.map((it) => { const copy = { ...it }; delete copy.screenshot; return copy; }),
      }));
    } catch { /* give up silently — in-memory basket still works this session */ }
  }
}

// Lazy-load the vendored html2canvas as a classic script (UMD attaches to
// window). CSP scriptSrc 'self' already allows /js/vendor/.
let _h2cPromise = null;
function loadHtml2canvas() {
  if (window.html2canvas) return Promise.resolve(window.html2canvas);
  if (_h2cPromise) return _h2cPromise;
  _h2cPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '/js/vendor/html2canvas.min.js';
    s.onload = () => (window.html2canvas ? resolve(window.html2canvas) : reject(new Error('html2canvas missing')));
    s.onerror = () => reject(new Error('html2canvas failed to load'));
    document.head.appendChild(s);
  });
  return _h2cPromise;
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export class ChangeRequestWidget {
  constructor() {
    this.root = null;
    this.panelOpen = false;
    this.picking = false;
    this.draft = null;     // item being composed (+ optional _editId)
    this.email = '';
    this.basket = loadBasket();
    this._onNav = this._onNav.bind(this);
    this._onPickMove = this._onPickMove.bind(this);
    this._onPickClick = this._onPickClick.bind(this);
    this._onKeydown = this._onKeydown.bind(this);
  }

  mount() {
    if (document.getElementById('cr-widget')) return;
    this._injectBadge();

    this.root = document.createElement('div');
    this.root.id = 'cr-widget';
    this.root.innerHTML = `
      <button type="button" class="cr-demo-toggle" id="cr-demo-toggle" aria-pressed="false">${DEMO_ICON}</button>
      <button type="button" class="cr-fab" id="cr-fab" aria-haspopup="dialog" aria-expanded="false">
        ${FAB_ICON}<span>${esc(t('changeRequest.open'))}</span>
        <span class="cr-fab__count" id="cr-count" data-count="0"></span>
      </button>
      <div class="cr-panel" id="cr-panel" role="dialog" aria-label="${esc(t('changeRequest.title'))}" hidden></div>
    `;
    document.body.appendChild(this.root);
    this.root.querySelector('#cr-fab').addEventListener('click', () => this.togglePanel());
    this.root.querySelector('#cr-demo-toggle').addEventListener('click', () => this.toggleDemoMode());
    this._updateFab();
    this._syncDemoToggle();

    window.addEventListener('popstate', this._onNav);
    window.addEventListener('spa:navigate', this._onNav);
    window.addEventListener('hashchange', this._onNav);
  }

  _injectBadge() {
    const nav = document.querySelector('.lol-nav');
    if (nav && !nav.querySelector('.test-env-badge')) {
      const badge = document.createElement('span');
      badge.className = 'test-env-badge';
      badge.textContent = t('changeRequest.badge');
      (nav.querySelector('.lol-nav__brand') || nav).appendChild(badge);
    }
  }

  // Demo mode — a presentation overlay (see test-env.css). Toggling flips the
  // body.is-demo-mode class (which hides the test chrome + collapses this widget
  // to a thin line), persists the choice, and refreshes the toggle's label.
  toggleDemoMode(on) {
    const next = on === undefined ? !document.body.classList.contains('is-demo-mode') : !!on;
    document.body.classList.toggle('is-demo-mode', next);
    setDemoMode(next);
    if (next) { this.togglePanel(false); this.endPick(); }
    this._syncDemoToggle();
  }

  _syncDemoToggle() {
    const btn = this.root?.querySelector('#cr-demo-toggle');
    if (!btn) return;
    const on = document.body.classList.contains('is-demo-mode');
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    const label = t(on ? 'changeRequest.demoExit' : 'changeRequest.demoEnter');
    btn.title = label;
    btn.setAttribute('aria-label', label);
  }

  // Full teardown — the inverse of mount(). Used by the theme switcher's
  // TEST-mode toggle. endPick() is a no-op when not picking; the handlers are
  // constructor-bound, so removeEventListener matches what mount() added.
  destroy() {
    this.endPick();
    window.removeEventListener('popstate', this._onNav);
    window.removeEventListener('spa:navigate', this._onNav);
    window.removeEventListener('hashchange', this._onNav);
    this.root?.remove();
    this.root = null;
    document.querySelector('.lol-nav .test-env-badge')?.remove();
  }

  _onNav() {
    // Keep the basket view's page labels fresh when navigating with the panel open.
    if (this.panelOpen && !this.draft) this._renderPanelBody();
  }

  _updateFab() {
    const count = this.basket.length;
    const el = this.root.querySelector('#cr-count');
    el.textContent = count ? String(count) : '';
    el.dataset.count = String(count);
    this.root.querySelector('#cr-fab').setAttribute('aria-expanded', this.panelOpen ? 'true' : 'false');
  }

  togglePanel(open) {
    this.panelOpen = open === undefined ? !this.panelOpen : open;
    const panel = this.root.querySelector('#cr-panel');
    panel.hidden = !this.panelOpen;
    this._updateFab();
    if (this.panelOpen) this._renderPanelBody();
  }

  _renderPanelBody() {
    const panel = this.root.querySelector('#cr-panel');
    if (this.draft) { this._renderNoteForm(panel); return; }
    this._renderBasket(panel);
  }

  // ── Basket / submit view ────────────────────────────────────────────────────
  _renderBasket(panel) {
    const items = this.basket;
    const loggedIn = !!getUser();
    const itemsHtml = items.length ? `<ul class="cr-list">${items.map((it, i) => `
      <li class="cr-item" data-idx="${i}">
        <div class="cr-item__page">${esc(it.page_label || it.page_url)}</div>
        ${it.element_label ? `<div class="cr-item__el">${esc(it.element_label)}</div>` : ''}
        <div class="cr-item__note">${esc(it.note)}</div>
        ${it.screenshot ? `<div class="cr-item__shot">${esc(t('changeRequest.screenshotAttached'))}</div>` : ''}
        <div class="cr-item__actions">
          <button type="button" data-act="edit">${esc(t('changeRequest.edit'))}</button>
          <button type="button" data-act="remove">${esc(t('changeRequest.remove'))}</button>
        </div>
      </li>`).join('')}</ul>`
      : `<p class="cr-empty">${esc(t('changeRequest.empty'))}</p>`;

    panel.innerHTML = `
      <div class="cr-panel__head">
        <h2 class="cr-panel__title">${esc(t('changeRequest.title'))}</h2>
        <button type="button" class="cr-panel__close" id="cr-close" aria-label="${esc(t('changeRequest.cancel'))}">×</button>
      </div>
      <div class="cr-panel__body">
        <p class="cr-hint">${esc(t('changeRequest.hintEmpty'))}</p>
        ${itemsHtml}
        ${!loggedIn ? `
          <div class="cr-field" style="margin-top:14px;">
            <label class="cr-label" for="cr-email">${esc(t('changeRequest.emailLabel'))}</label>
            <input type="email" class="cr-input" id="cr-email" value="${esc(this.email)}" placeholder="${esc(t('changeRequest.emailPlaceholder'))}" />
          </div>` : ''}
      </div>
      <div class="cr-panel__foot">
        <button type="button" class="cr-btn cr-btn--block" id="cr-pick">${esc(t('changeRequest.pick'))}</button>
        <button type="button" class="cr-btn cr-btn--primary cr-btn--block" id="cr-submit" ${items.length ? '' : 'disabled'}>
          ${esc(t('changeRequest.submitAll'))}${items.length ? ` (${items.length})` : ''}
        </button>
      </div>
    `;

    panel.querySelector('#cr-close').addEventListener('click', () => this.togglePanel(false));
    panel.querySelector('#cr-pick').addEventListener('click', () => this.startPick());
    panel.querySelector('#cr-submit').addEventListener('click', () => this.submitAll());
    const emailInput = panel.querySelector('#cr-email');
    if (emailInput) emailInput.addEventListener('input', (e) => { this.email = e.target.value; });

    panel.querySelectorAll('.cr-item').forEach((li) => {
      const idx = Number(li.dataset.idx);
      li.querySelector('[data-act="edit"]').addEventListener('click', () => this.editItem(idx));
      li.querySelector('[data-act="remove"]').addEventListener('click', () => this.removeItem(idx));
    });
  }

  // ── Note form ───────────────────────────────────────────────────────────────
  _renderNoteForm(panel) {
    const d = this.draft;
    panel.innerHTML = `
      <div class="cr-panel__head">
        <h2 class="cr-panel__title">${esc(t('changeRequest.noteTitle'))}</h2>
        <button type="button" class="cr-panel__close" id="cr-close" aria-label="${esc(t('changeRequest.cancel'))}">×</button>
      </div>
      <div class="cr-panel__body">
        <div class="cr-field">
          <span class="cr-label">${esc(t('changeRequest.page'))}</span>
          <div class="cr-target">${esc(d.page_label)} — ${esc(d.page_url)}</div>
        </div>
        <div class="cr-field">
          <label class="cr-label" for="cr-el">${esc(t('changeRequest.element'))}</label>
          <input type="text" class="cr-input" id="cr-el" value="${esc(d.element_label || '')}" />
          ${d.element_selector ? `<div class="cr-target" style="margin-top:6px;">${esc(d.element_selector)}</div>` : ''}
        </div>
        <div class="cr-field">
          <label class="cr-label" for="cr-note">${esc(t('changeRequest.note'))}</label>
          <textarea class="cr-input" id="cr-note" placeholder="${esc(t('changeRequest.notePlaceholder'))}">${esc(d.note || '')}</textarea>
        </div>
        <label class="cr-checkbox">
          <input type="checkbox" id="cr-shot" ${d.screenshot ? 'checked' : ''} />
          <span id="cr-shot-label">${esc(d.screenshot ? t('changeRequest.screenshotAttached') : t('changeRequest.attachScreenshot'))}</span>
        </label>
      </div>
      <div class="cr-panel__foot">
        <button type="button" class="cr-btn cr-btn--block" id="cr-cancel">${esc(t('changeRequest.cancel'))}</button>
        <button type="button" class="cr-btn cr-btn--primary cr-btn--block" id="cr-add">${esc(t('changeRequest.addToBasket'))}</button>
      </div>
    `;

    const noteEl = panel.querySelector('#cr-note');
    const elEl = panel.querySelector('#cr-el');
    panel.querySelector('#cr-close').addEventListener('click', () => this.cancelDraft());
    panel.querySelector('#cr-cancel').addEventListener('click', () => this.cancelDraft());
    panel.querySelector('#cr-add').addEventListener('click', () => {
      this.draft.note = noteEl.value;
      this.draft.element_label = elEl.value;
      this.addDraftToBasket();
    });

    const shot = panel.querySelector('#cr-shot');
    shot.addEventListener('change', async () => {
      if (!shot.checked) { this.draft.screenshot = null; this._setShotLabel(panel, false); return; }
      this.draft.note = noteEl.value;
      this.draft.element_label = elEl.value;
      await this.captureScreenshot(panel);
    });

    noteEl.focus();
  }

  _setShotLabel(panel, attached) {
    const lbl = panel.querySelector('#cr-shot-label');
    if (lbl) lbl.textContent = attached ? t('changeRequest.screenshotAttached') : t('changeRequest.attachScreenshot');
  }

  async captureScreenshot(panel) {
    const lbl = panel.querySelector('#cr-shot-label');
    if (lbl) lbl.textContent = t('changeRequest.capturing');
    // Hide all widget UI so it isn't baked into the screenshot.
    const prevDisplay = this.root.style.display;
    this.root.style.display = 'none';
    try {
      const h2c = await loadHtml2canvas();
      const canvas = await h2c(document.body, { scale: 0.5, logging: false, useCORS: true });
      this.draft.screenshot = canvas.toDataURL('image/png');
      this.root.style.display = prevDisplay;
      this._setShotLabel(panel, true);
    } catch (err) {
      this.root.style.display = prevDisplay;
      this.draft.screenshot = null;
      const cb = panel.querySelector('#cr-shot');
      if (cb) cb.checked = false;
      this._setShotLabel(panel, false);
      showToast(t('changeRequest.screenshotError'), 'error');
      console.error('[change-request] screenshot failed', err);
    }
  }

  // ── Element picking ─────────────────────────────────────────────────────────
  startPick() {
    if (this.picking) return;
    this.picking = true;
    this.togglePanel(false);
    document.body.classList.add('cr-picking');

    this._outline = document.createElement('div');
    this._outline.id = 'cr-pick-outline';
    document.body.appendChild(this._outline);

    this._banner = document.createElement('div');
    this._banner.id = 'cr-pick-banner';
    this._banner.textContent = t('changeRequest.pickBanner');
    document.body.appendChild(this._banner);

    document.addEventListener('mousemove', this._onPickMove, true);
    document.addEventListener('click', this._onPickClick, true);
    document.addEventListener('keydown', this._onKeydown, true);
  }

  _isWidgetEl(el) {
    return !!(el && el.closest && (el.closest('#cr-widget') || el.id === 'cr-pick-outline' || el.id === 'cr-pick-banner'));
  }

  _onPickMove(e) {
    const el = e.target;
    if (this._isWidgetEl(el) || !(el instanceof Element)) { this._outline.style.display = 'none'; return; }
    const r = el.getBoundingClientRect();
    Object.assign(this._outline.style, {
      display: 'block',
      top: `${r.top}px`, left: `${r.left}px`,
      width: `${r.width}px`, height: `${r.height}px`,
    });
  }

  _onPickClick(e) {
    if (this._isWidgetEl(e.target)) return; // let widget UI work normally
    // Pre-empt the app: stop the click from triggering links/buttons/router.
    e.preventDefault();
    e.stopImmediatePropagation();
    const el = e.target;
    const page = currentPageInfo();
    this.endPick();
    this.draft = {
      _editId: null,
      page_url: page.page_url,
      page_label: page.page_label,
      element_selector: buildSelector(el),
      element_label: labelFor(el),
      note: '',
      screenshot: null,
    };
    this.togglePanel(true); // renders the note form (draft set)
  }

  _onKeydown(e) {
    if (e.key === 'Escape') { e.preventDefault(); this.endPick(); }
  }

  endPick() {
    this.picking = false;
    document.body.classList.remove('cr-picking');
    document.removeEventListener('mousemove', this._onPickMove, true);
    document.removeEventListener('click', this._onPickClick, true);
    document.removeEventListener('keydown', this._onKeydown, true);
    this._outline?.remove();
    this._banner?.remove();
    this._outline = this._banner = null;
  }

  // ── Basket mutations ────────────────────────────────────────────────────────
  addDraftToBasket() {
    const d = this.draft;
    if (!d.note || !d.note.trim()) { showToast(t('changeRequest.noteRequired'), 'error'); return; }
    const item = {
      id: (crypto.randomUUID && crypto.randomUUID()) || String(Date.now() + Math.random()),
      page_url: d.page_url,
      page_label: d.page_label,
      element_selector: d.element_selector,
      element_label: d.element_label,
      note: d.note.trim(),
      screenshot: d.screenshot || null,
    };
    if (d._editId) {
      const idx = this.basket.findIndex(b => b.id === d._editId);
      if (idx >= 0) { item.id = d._editId; this.basket[idx] = item; }
      else this.basket.push(item);
    } else {
      this.basket.push(item);
    }
    saveBasket(this.basket);
    this.draft = null;
    this._updateFab();
    this._renderPanelBody();
  }

  cancelDraft() {
    this.draft = null;
    this._renderPanelBody();
  }

  editItem(idx) {
    const it = this.basket[idx];
    if (!it) return;
    this.draft = { ...it, _editId: it.id };
    this._renderPanelBody();
  }

  removeItem(idx) {
    this.basket.splice(idx, 1);
    saveBasket(this.basket);
    this._updateFab();
    this._renderPanelBody();
  }

  // ── Submit ──────────────────────────────────────────────────────────────────
  async submitAll() {
    if (!this.basket.length) return;
    const btn = this.root.querySelector('#cr-submit');
    if (btn) { btn.disabled = true; btn.textContent = t('changeRequest.submitting'); }
    try {
      const token = await getCSRFToken();
      const res = await fetch('/api/v1/change-requests', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...(token ? { 'X-CSRF-Token': token } : {}) },
        body: JSON.stringify({
          email: this.email || undefined,
          items: this.basket.map(it => ({
            page_url: it.page_url,
            page_label: it.page_label,
            element_selector: it.element_selector,
            element_label: it.element_label,
            note: it.note,
            screenshot: it.screenshot || undefined,
          })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || t('changeRequest.submitError'));
      this.basket = [];
      this.email = '';
      saveBasket(this.basket);
      this._updateFab();
      this.togglePanel(false);
      showToast(t('changeRequest.submitted'), 'success', 4000);
    } catch (err) {
      showToast(err.message || t('changeRequest.submitError'), 'error', 5000);
      this._renderPanelBody();
    }
  }
}

// Module-scoped singleton so main.js (boot) and ThemeSwitcher (the runtime
// TEST-mode toggle) mount/unmount the same instance — ES-module caching
// guarantees both importers share it.
let _mounted = null;

export function mountChangeRequestWidget() {
  if (!_mounted) {
    _mounted = new ChangeRequestWidget();
    _mounted.mount();
  }
  return _mounted;
}

export function unmountChangeRequestWidget() {
  _mounted?.destroy();
  _mounted = null;
}

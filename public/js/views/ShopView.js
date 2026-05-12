// ShopView — public product listing with search + filters + sort.
// Route: #/shop?q=...&shapes=...&cap=...&min=...&max=...&stock=1&sort=...
//
// The hero block (eyebrow/title/subtitle/empty_state) is editable by
// admin/moderator via an inline WYSIWYG edit mode, persisted to the
// `shop_hero` key in site_content. Follows the pattern in ContactView.
import { renderProductCard } from '../components/ProductCard.js';
import { CurrencySelector } from '../components/CurrencySelector.js';
import { ShopFilters, applyFilters, parseStateFromQs, stateToQs } from '../components/ShopFilters.js';
import * as cart from '../services/cart.js';
import { isAdmin, hasRole, getCSRFToken } from '../services/auth.js';
import { openProductFormModal } from './AdminProductsView.js';
import { t, adminLocaleBadgeHtml, checkUntranslated } from '../i18n/i18n.js';

// Default copy — rendered when the DB row is missing or the network fails.
const DEFAULT_HERO = {
  eyebrow:     'From the workshop',
  title:       'Shop',
  subtitle:    'Smiley apparel and goods — prices include 24% VAT.',
  empty_state: 'No products match your filters.',
};

function _esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export class ShopView {
  constructor(_params, qs) {
    this._view = null;
    this._products = [];
    this._filtered = [];
    this._state    = parseStateFromQs(qs || '');
    this._currencySelector = null;
    this._filters = null;
    this._unsubCart = null;
    this._hero = { ...DEFAULT_HERO };
  }

  async render() {
    this._view = document.createElement('div');
    this._view.className = 'view shop-page';

    // Fetch editable copy before first paint so the shell is complete.
    await this._loadHero();

    this._view.innerHTML = `
      ${this._heroHtml()}

      <div class="shop-page__inner">
        <div class="shop-page__toolbar">
          <div id="shop-page-currency"></div>
        </div>

        <div id="shop-page-filters"></div>

        <p class="shop-page__count" id="shop-page-count" aria-live="polite"></p>

        <div class="shop-page__grid" id="shop-grid" aria-live="polite">
          <div class="shop-page__loading">${t('form.loading')}</div>
        </div>
      </div>
    `;

    this._currencySelector = new CurrencySelector({ onChange: () => this._repaintGrid() });
    this._view.querySelector('#shop-page-currency').appendChild(this._currencySelector.render());

    this._filters = new ShopFilters({
      initialState: this._state,
      products: [],
      onChange: (next) => {
        this._state = next;
        this._syncHash();
        this._repaintGrid();
      },
    });
    this._view.querySelector('#shop-page-filters').appendChild(this._filters.render());

    this._unsubCart = cart.subscribe(() => this._repaintGrid());

    // Admin/moderator-only inline edit controls.
    this._initPageEdit(this._view);

    await this._loadProducts();
    return this._view;
  }

  _heroHtml() {
    const h = this._hero;
    return `
      <header class="shop-page__header" data-section="hero">
        <div class="shop-page__header-inner">
          <p class="shop-page__eyebrow" data-field="eyebrow">${_esc(h.eyebrow)}</p>
          <h1 class="shop-page__title" data-field="title">${_esc(h.title)}</h1>
          <p class="shop-page__sub" data-field="subtitle">${_esc(h.subtitle)}</p>
        </div>
      </header>`;
  }

  async _loadHero() {
    try {
      const res = await fetch(`/api/v1/content/shop_hero?locale=${encodeURIComponent(window.__locale || 'en')}`);
      if (res.ok) {
        const data = await res.json();
        this._hero = this._mergeWithDefaults(DEFAULT_HERO, data);
        return;
      }
    } catch { /* fall through */ }
    this._hero = { ...DEFAULT_HERO };
  }

  // Deep-ish merge — keep defaults for any missing keys so partial rows render.
  _mergeWithDefaults(defaults, data) {
    const out = JSON.parse(JSON.stringify(defaults));
    if (!data || typeof data !== 'object') return out;
    for (const [k, v] of Object.entries(data)) {
      if (v !== null && v !== undefined && v !== '') out[k] = v;
    }
    return out;
  }

  async _loadProducts() {
    try {
      const res = await fetch('/api/v1/shop/products', { credentials: 'include' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load products');
      this._products = data.products || [];
      if (this._filters) this._filters.setProducts(this._products);
      this._repaintGrid();
    } catch (err) {
      const grid = this._view.querySelector('#shop-grid');
      grid.innerHTML = `<p class="shop-page__error">Couldn't load products: ${err.message}</p>`;
    }
  }

  _repaintGrid() {
    if (!this._view) return;
    const grid  = this._view.querySelector('#shop-grid');
    const count = this._view.querySelector('#shop-page-count');
    if (!grid) return;

    const cur = cart.getCurrency();
    this._filtered = applyFilters(this._products, this._state, cur);

    const total = this._products.length;
    const shown = this._filtered.length;
    if (shown === total) {
      count.textContent = `${total} ${t('shop.products')}`;
    } else {
      count.textContent = `${shown} ${t('shop.of')} ${total} ${t('shop.products')}`;
    }

    if (this._filtered.length === 0) {
      // Honour the admin-editable empty-state copy from shop_hero.
      grid.innerHTML = `
        <p class="shop-page__empty">
          ${_esc(this._hero.empty_state || DEFAULT_HERO.empty_state)}
          <button type="button" class="shop-page__empty-reset" id="shop-empty-reset">${t('shop.clearFilters')}</button>
        </p>`;
      grid.querySelector('#shop-empty-reset')?.addEventListener('click', () => {
        this._filters.resetState();
      });
      return;
    }
    grid.innerHTML = '';
    for (const p of this._filtered) {
      grid.appendChild(renderProductCard(p));
    }
  }

  _syncHash() {
    const qs = stateToQs(this._state);
    const newHash = qs ? `#/shop?${qs}` : '#/shop';
    if (window.location.hash !== newHash) {
      history.replaceState(null, '', newHash);
    }
  }

  // ── Inline edit (admin/moderator only) ───────────────────────────────────

  _initPageEdit(view) {
    if (!isAdmin() && !hasRole('moderator')) return;

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'shop-view__edit-btn';
    editBtn.setAttribute('data-testid', 'edit-shop-page-btn');
    editBtn.textContent = t('admin.editPage');
    view.appendChild(editBtn);

    // "Add Product" floating button — admin only (creation uses the
    // admin-only POST /api/v1/admin/shop/products endpoint). Sits just
    // below the Edit Page button. Reuses the same modal as the
    // AdminProductsView so the form stays a single source of truth.
    if (isAdmin()) {
      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'shop-view__add-btn';
      addBtn.setAttribute('data-testid', 'add-product-btn');
      addBtn.textContent = `+ ${t('admin.addProduct')}`;
      view.appendChild(addBtn);

      addBtn.addEventListener('click', () => {
        openProductFormModal({
          existing: null,
          onSaved: async () => { await this._loadProducts(); },
        });
      });
    }

    const controls = document.createElement('div');
    controls.className = 'shop-view__edit-controls shop-view__edit-controls--hidden';
    controls.innerHTML = `
      ${adminLocaleBadgeHtml()}
      <button type="button" class="shop-view__save-btn"
              data-testid="edit-shop-page-save">${t('form.saveChanges')}</button>
      <button type="button" class="shop-view__cancel-btn"
              data-testid="edit-shop-page-cancel">${t('admin.cancel')}</button>
      <span class="shop-view__edit-status" aria-live="polite"></span>`;
    view.appendChild(controls);

    let snapshot = null;

    editBtn.addEventListener('click', () => {
      // Add an editable surface for the empty-state string. It isn't part
      // of the rendered hero (empty state only paints when filters match
      // zero products), so we expose it as an extra inline field in the
      // hero block during edit mode.
      const heroInner = view.querySelector('.shop-page__header-inner');
      if (heroInner && !heroInner.querySelector('[data-field="empty_state"]')) {
        const row = document.createElement('p');
        row.className = 'shop-page__edit-only shop-page__empty-preview';
        row.innerHTML =
          `<span class="shop-page__edit-only-label">Empty-state message:</span>
           <span data-field="empty_state">${_esc(this._hero.empty_state)}</span>`;
        heroInner.appendChild(row);
      }

      snapshot = JSON.parse(JSON.stringify(this._hero));
      this._enterEdit(view, editBtn, controls);
    });

    controls.querySelector('.shop-view__save-btn').addEventListener('click', () =>
      this._saveHero(view, editBtn, controls)
    );

    controls.querySelector('.shop-view__cancel-btn').addEventListener('click', () => {
      if (snapshot) {
        this._hero = snapshot;
        this._repaintHero(view);
      }
      this._exitEdit(view, editBtn, controls);
    });
  }

  _enterEdit(view, editBtn, controls) {
    view.classList.add('shop-view--editing');
    editBtn.classList.add('shop-view__edit-btn--hidden');
    controls.classList.remove('shop-view__edit-controls--hidden');
    checkUntranslated('shop_hero', controls);
    view.querySelectorAll('[data-field]').forEach(el => {
      el.contentEditable = 'true';
      el.spellcheck = true;
    });
  }

  _exitEdit(view, editBtn, controls) {
    view.classList.remove('shop-view--editing');
    editBtn.classList.remove('shop-view__edit-btn--hidden');
    controls.classList.add('shop-view__edit-controls--hidden');
    controls.querySelector('.shop-view__edit-status').textContent = '';
    view.querySelectorAll('[data-field]').forEach(el => {
      el.contentEditable = 'false';
      el.removeAttribute('contenteditable');
    });
    // Remove the edit-only preview row if we added one.
    view.querySelectorAll('.shop-page__edit-only').forEach(el => el.remove());
  }

  _readField(root, field, fallback) {
    const el = root.querySelector(`[data-field="${field}"]`);
    // textContent (not innerText) to get the underlying DOM text — avoids
    // CSS text-transform: uppercase leaking into what we persist.
    return (el?.textContent || '').trim() || fallback;
  }

  _repaintHero(view) {
    const header = view.querySelector('[data-section="hero"]');
    if (!header) return;
    header.outerHTML = this._heroHtml();
  }

  async _saveHero(view, editBtn, controls) {
    const status = controls.querySelector('.shop-view__edit-status');
    status.textContent = t('form.saving');

    const header = view.querySelector('[data-section="hero"]');
    const next = {
      eyebrow:     this._readField(header, 'eyebrow',     DEFAULT_HERO.eyebrow),
      title:       this._readField(header, 'title',       DEFAULT_HERO.title),
      subtitle:    this._readField(header, 'subtitle',    DEFAULT_HERO.subtitle),
      empty_state: this._readField(header, 'empty_state', DEFAULT_HERO.empty_state),
    };

    let token = null;
    try { token = await getCSRFToken(); } catch { /* fine */ }

    try {
      const res = await fetch(`/api/v1/content/shop_hero?locale=${encodeURIComponent(window.__locale || 'en')}`, {
        method: 'PUT',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'X-CSRF-Token': token } : {}),
        },
        body: JSON.stringify(next),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || res.statusText);
      }
      const saved = await res.json();
      this._hero = this._mergeWithDefaults(DEFAULT_HERO, saved);
      this._repaintHero(view);
      // Also repaint the grid's empty-state copy (if visible).
      this._repaintGrid();
      status.textContent = t('form.saved');
      setTimeout(() => this._exitEdit(view, editBtn, controls), 900);
    } catch (err) {
      status.textContent = `Save failed — ${err.message}`;
    }
  }

  destroy() {
    if (this._currencySelector) this._currencySelector.destroy();
    if (this._filters) this._filters.destroy();
    if (this._unsubCart) this._unsubCart();
  }
}

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

// Shop-redesign step 2: section slug → DB `category` value.
// `null` ⇒ no filter (the /shop landing shows every active row).
const SECTION_TO_CATEGORY = {
  products:  'product',
  tech:      'tech_service',
  carpentry: 'carpentry_service',
};

// Order matters — drives the tab bar order. 'all' maps to the umbrella /shop.
const SECTION_TABS = ['all', 'products', 'tech', 'carpentry'];

function _esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Landing-row definitions — drive both the row order on /shop and the
// "See all →" links. Step 4: every row maps to a section sub-route, so the
// landing is purely a discovery surface; deep browse happens on the section
// pages with filters.
const LANDING_ROWS = [
  { section: 'products',  category: 'product' },
  { section: 'tech',      category: 'tech_service' },
  { section: 'carpentry', category: 'carpentry_service' },
];

// Cards rendered per row on the landing. More than this and the row stops
// feeling "featured" — section pages handle the long tail.
const LANDING_ROW_LIMIT = 4;

export class ShopView {
  constructor(params, qs) {
    this._view = null;
    this._products = [];
    this._filtered = [];
    this._state    = parseStateFromQs(qs || '');
    this._currencySelector = null;
    this._filters = null;
    this._unsubCart = null;
    this._hero = { ...DEFAULT_HERO };
    // params is either null (/shop landing) or { section: 'products' | 'tech' | 'carpentry' }.
    this._section  = params?.section || null;
    this._category = this._section ? (SECTION_TO_CATEGORY[this._section] || null) : null;
    // Landing-mode state: per-section product lists fetched in parallel.
    this._landingSections = Object.fromEntries(LANDING_ROWS.map(r => [r.section, []]));
  }

  async render() {
    this._view = document.createElement('div');
    this._view.className = 'view shop-page';

    // Fetch editable copy before first paint so the shell is complete.
    await this._loadHero();

    // Shop redesign step 4 — the /shop landing is now a mixed-row discovery
    // surface (no filters, no search bar, no flat grid). Section sub-routes
    // keep the existing filterable grid layout.
    const body = this._section ? this._sectionBodyHtml() : this._landingBodyHtml();
    this._view.innerHTML = `
      ${this._heroHtml()}
      ${this._tabsHtml()}
      ${body}
    `;

    // Admin/moderator-only inline edit controls — appended on both layouts so
    // hero copy stays editable from the landing too.
    this._initPageEdit(this._view);

    if (this._section) {
      // Section mode — flat grid + filters + currency toggle.
      this._currencySelector = new CurrencySelector({ onChange: () => this._repaintGrid() });
      this._view.querySelector('#shop-page-currency').appendChild(this._currencySelector.render());

      this._filters = new ShopFilters({
        initialState: this._state,
        products: [],
        section: this._section,
        onChange: (next) => {
          this._state = next;
          this._syncHash();
          this._repaintGrid();
        },
      });
      this._view.querySelector('#shop-page-filters').appendChild(this._filters.render());
      this._unsubCart = cart.subscribe(() => this._repaintGrid());
      await this._loadProducts();
    } else {
      // Landing mode — re-paint rows when currency changes elsewhere so the
      // per-card prices stay in sync. No filter/search controls.
      this._unsubCart = cart.subscribe(() => this._paintLandingRows());
      await this._loadLandingSections();
    }

    return this._view;
  }

  // Shop redesign step 4 — landing-mode body shell. The actual row content is
  // painted async by _paintLandingRows after _loadLandingSections resolves.
  _landingBodyHtml() {
    return `
      <div class="shop-landing" aria-live="polite">
        <div class="shop-landing__loading">${t('form.loading')}</div>
      </div>
    `;
  }

  _sectionBodyHtml() {
    return `
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
  }

  _heroHtml() {
    const h = this._hero;
    // On section sub-routes the H1 reflects the section, not the shared
    // shop_hero copy — admins still edit the hero for /shop (the "All" tab),
    // and the section-specific title is i18n-driven so each route stays
    // independently SEO-indexable. Eyebrow + subtitle still come from the
    // hero block so the page keeps a cohesive feel across tabs.
    const sectionTitle = this._section ? t(`shop.section.${this._section}.title`) : null;
    const title = sectionTitle || h.title;
    return `
      <header class="shop-page__header" data-section="hero">
        <div class="shop-page__header-inner">
          <p class="shop-page__eyebrow" data-field="eyebrow">${_esc(h.eyebrow)}</p>
          <h1 class="shop-page__title" data-field="title">${_esc(title)}</h1>
          <p class="shop-page__sub" data-field="subtitle">${_esc(h.subtitle)}</p>
        </div>
      </header>`;
  }

  _tabsHtml() {
    // Persistent department tab bar — sits below the global nav and above
    // the hero. Active tab gets the gold underline via .is-active.
    const current = this._section || 'all';
    const locale = (window.__locale || 'en');
    const tabs = SECTION_TABS.map(slug => {
      const href = slug === 'all' ? `/${locale}/shop` : `/${locale}/shop/${slug}`;
      const label = t(`shop.tab.${slug}`);
      const active = slug === current;
      return `<a href="${href}" class="shop-page__tab${active ? ' is-active' : ''}"
                 data-tab="${slug}"
                 ${active ? 'aria-current="page"' : ''}>${_esc(label)}</a>`;
    }).join('');
    return `
      <nav class="shop-page__tabs" aria-label="${_esc(t('shop.tabsAriaLabel'))}">
        <div class="shop-page__tabs-inner">${tabs}</div>
      </nav>`;
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
      const url = this._category
        ? `/api/v1/shop/products?category=${encodeURIComponent(this._category)}`
        : '/api/v1/shop/products';
      const res = await fetch(url, { credentials: 'include' });
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

  // Shop redesign step 4 — landing-mode data load. Fires one request per row
  // in parallel (each is an indexed category lookup, sub-millisecond on the
  // DB side) so total latency tracks the slowest single fetch.
  async _loadLandingSections() {
    const wrap = this._view.querySelector('.shop-landing');
    try {
      const results = await Promise.all(LANDING_ROWS.map(async (row) => {
        const res = await fetch(
          `/api/v1/shop/products?category=${encodeURIComponent(row.category)}`,
          { credentials: 'include' }
        );
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || `Failed to load ${row.section}`);
        }
        const data = await res.json();
        return [row.section, data.products || []];
      }));
      this._landingSections = Object.fromEntries(results);
      this._paintLandingRows();
    } catch (err) {
      if (wrap) wrap.innerHTML = `<p class="shop-page__error">Couldn't load shop: ${_esc(err.message)}</p>`;
    }
  }

  _paintLandingRows() {
    const wrap = this._view?.querySelector('.shop-landing');
    if (!wrap) return;
    wrap.innerHTML = LANDING_ROWS.map(row => {
      const products = (this._landingSections[row.section] || []).slice(0, LANDING_ROW_LIMIT);
      const locale = (window.__locale || 'en');
      const seeAllHref = `/${locale}/shop/${row.section}`;
      const title    = t(`shop.landing.${row.section}.title`);
      const seeLabel = t(`shop.landing.${row.section}.seeAll`);
      const cards = products.length === 0
        ? `<p class="shop-landing__empty">${_esc(t('shop.landing.empty'))}</p>`
        : `<div class="shop-landing__row-cards" data-section="${row.section}"></div>`;
      return `
        <section class="shop-landing__row" data-section="${row.section}">
          <header class="shop-landing__row-header">
            <h2 class="shop-landing__row-title">${_esc(title)}</h2>
            <a class="shop-landing__see-all" href="${seeAllHref}"
               data-testid="shop-landing-see-all-${row.section}">${_esc(seeLabel)} →</a>
          </header>
          ${cards}
        </section>`;
    }).join('');

    // Mount cards into each row container. Done in a second pass so the
    // markup-only render (above) can ship the row chrome immediately while
    // we hydrate the DOM nodes.
    for (const row of LANDING_ROWS) {
      const container = wrap.querySelector(`.shop-landing__row-cards[data-section="${row.section}"]`);
      if (!container) continue;
      const products = (this._landingSections[row.section] || []).slice(0, LANDING_ROW_LIMIT);
      for (const p of products) container.appendChild(renderProductCard(p));
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
    // Persist filter state in the querystring on the *current* section route
    // so refreshes / shares keep both the tab and the active filters. The
    // pathname already encodes the section ('/en/shop/tech'), so we only
    // need to swap the search portion.
    const qs = stateToQs(this._state);
    const base = window.location.pathname;
    const next = qs ? `${base}?${qs}` : base;
    const current = window.location.pathname + (window.location.search || '');
    if (current !== next) {
      history.replaceState(null, '', next + window.location.hash);
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
          // Reload the right surface — section pages refresh their filtered
          // grid, the /shop landing re-pulls every featured row.
          onSaved: async () => {
            if (this._section) await this._loadProducts();
            else               await this._loadLandingSections();
          },
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

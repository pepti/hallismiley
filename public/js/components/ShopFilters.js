// ShopFilters — search, filter chips, and sort for the shop grid.
// Fully client-side: receives the full product list, emits filtered+sorted
// results + a URL-query-string representation via onChange.
import * as cart from '../services/cart.js';
import { t } from '../i18n/i18n.js';

const SHAPE_IDS = ['aero', 'tall', 'long', 'low', 'cube', 'classic'];

// Buckets are non-overlapping so a product never matches more than one.
// "450L+" is inclusive (450 counts as 450L+).
const CAPACITY_BUCKETS = [
  { id: 'under-350', min: 0,   max: 349 },
  { id: '350-449',   min: 350, max: 449 },
  { id: 'over-450',  min: 450, max: 99999 },
];

// Shop redesign step 3 — duration buckets for the tech-services tab.
// Non-overlapping ranges keyed off duration_minutes. "1h" covers anything
// up to and including a 90-minute session; "half-day" is up to 5h; "full-day"
// is anything longer.
const DURATION_BUCKETS = [
  { id: '1h',       min: 1,   max: 90 },
  { id: 'half-day', min: 91,  max: 300 },
  { id: 'full-day', min: 301, max: 99999 },
];

const DELIVERY_FORMATS = ['remote', 'in_person', 'hybrid'];

// Per-section visibility. 'auto' means "show only if at least one visible
// product has a value for that field" (the legacy behavior). true / false
// always show / always hide. Shop redesign step 3.
//
// `all` is the umbrella /shop landing — the auto-detect keeps shape/capacity
// off when the catalogue has none of those.
// `products` is physical goods — surfaces price + in-stock + subcategory chips
// for tags like 'apparel', 'accessories', 'roof_box'.
// `tech` and `carpentry` swap stock for the service-specific axes and skip
// shape/capacity entirely since services never carry those.
const FILTER_CONFIG = {
  all:       { shape: 'auto', capacity: 'auto', price: true, stock: true,  duration: false, format: false, subcategory: false },
  products:  { shape: false,  capacity: false,  price: true, stock: true,  duration: false, format: false, subcategory: 'auto' },
  tech:      { shape: false,  capacity: false,  price: true, stock: false, duration: true,  format: true,  subcategory: false },
  carpentry: { shape: false,  capacity: false,  price: true, stock: false, duration: false, format: true,  subcategory: 'auto' },
};

const DEFAULT_STATE = {
  q: '',
  shapes: [],        // array of shape ids
  capacities: [],    // array of bucket ids
  durations: [],     // array of DURATION_BUCKETS ids — services only
  formats: [],       // array of DELIVERY_FORMATS — services only
  subcategories: [], // array of subcategory strings — auto-populated from products
  priceMin: '',      // string to allow empty
  priceMax: '',
  inStockOnly: false,
  sort: 'featured',
};

// Serialise/deserialise state to/from a URL query string.
export function parseStateFromQs(qs) {
  const p = new URLSearchParams(qs || '');
  const state = { ...DEFAULT_STATE };
  if (p.has('q'))      state.q = p.get('q');
  if (p.has('shapes')) state.shapes = p.get('shapes').split(',').filter(Boolean);
  if (p.has('cap'))    state.capacities = p.get('cap').split(',').filter(Boolean);
  // Shop redesign step 3 — service axes.
  if (p.has('dur'))    state.durations = p.get('dur').split(',').filter(Boolean);
  if (p.has('fmt'))    state.formats = p.get('fmt').split(',').filter(Boolean);
  if (p.has('sub'))    state.subcategories = p.get('sub').split(',').filter(Boolean);
  if (p.has('min'))    state.priceMin = p.get('min');
  if (p.has('max'))    state.priceMax = p.get('max');
  if (p.get('stock') === '1') state.inStockOnly = true;
  if (p.has('sort'))   state.sort = p.get('sort');
  return state;
}

export function stateToQs(state) {
  const p = new URLSearchParams();
  if (state.q) p.set('q', state.q);
  if (state.shapes && state.shapes.length) p.set('shapes', state.shapes.join(','));
  if (state.capacities && state.capacities.length) p.set('cap', state.capacities.join(','));
  if (state.durations && state.durations.length) p.set('dur', state.durations.join(','));
  if (state.formats && state.formats.length) p.set('fmt', state.formats.join(','));
  if (state.subcategories && state.subcategories.length) p.set('sub', state.subcategories.join(','));
  if (state.priceMin) p.set('min', String(state.priceMin));
  if (state.priceMax) p.set('max', String(state.priceMax));
  if (state.inStockOnly) p.set('stock', '1');
  if (state.sort && state.sort !== 'featured') p.set('sort', state.sort);
  return p.toString();
}

export function applyFilters(products, state, currency) {
  let out = products.slice();

  // Search — case-insensitive match on name + description
  if (state.q) {
    const q = state.q.toLowerCase().trim();
    out = out.filter(p =>
      p.name.toLowerCase().includes(q) ||
      (p.description && p.description.toLowerCase().includes(q))
    );
  }

  if (state.shapes && state.shapes.length) {
    const s = new Set(state.shapes);
    out = out.filter(p => p.shape && s.has(p.shape));
  }

  if (state.capacities && state.capacities.length) {
    const buckets = CAPACITY_BUCKETS.filter(b => state.capacities.includes(b.id));
    out = out.filter(p => {
      if (!p.capacity_litres) return false;
      return buckets.some(b => p.capacity_litres >= b.min && p.capacity_litres <= b.max);
    });
  }

  // Shop redesign step 3 — service axes.
  if (state.durations && state.durations.length) {
    const buckets = DURATION_BUCKETS.filter(b => state.durations.includes(b.id));
    out = out.filter(p => {
      if (p.duration_minutes == null) return false;
      const m = Number(p.duration_minutes);
      return buckets.some(b => m >= b.min && m <= b.max);
    });
  }

  if (state.formats && state.formats.length) {
    const f = new Set(state.formats);
    out = out.filter(p => p.delivery_format && f.has(p.delivery_format));
  }

  if (state.subcategories && state.subcategories.length) {
    const s = new Set(state.subcategories);
    out = out.filter(p => p.subcategory && s.has(p.subcategory));
  }

  const priceField = currency === 'ISK' ? 'price_isk' : 'price_eur';
  // Price range — user types values in displayed currency units.
  // For ISK the input is in whole krónur (no conversion).
  // For EUR the input is in euros, so convert to stored cents before comparing.
  const toMinor = (v) => currency === 'EUR' ? Math.round(Number(v) * 100) : Number(v);
  if (state.priceMin !== '' && !Number.isNaN(Number(state.priceMin))) {
    const min = toMinor(state.priceMin);
    out = out.filter(p => p[priceField] >= min);
  }
  if (state.priceMax !== '' && !Number.isNaN(Number(state.priceMax))) {
    const max = toMinor(state.priceMax);
    out = out.filter(p => p[priceField] <= max);
  }

  if (state.inStockOnly) {
    out = out.filter(p => Number(p.stock) > 0);
  }

  // Sort
  switch (state.sort) {
    case 'price-asc':
      out.sort((a, b) => a[priceField] - b[priceField]); break;
    case 'price-desc':
      out.sort((a, b) => b[priceField] - a[priceField]); break;
    case 'newest':
      out.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)); break;
    case 'name':
      out.sort((a, b) => a.name.localeCompare(b.name)); break;
    case 'featured':
    default:
      // preserve original order
      break;
  }

  return out;
}

export class ShopFilters {
  constructor({ initialState = {}, products = [], onChange, section = null } = {}) {
    this._state = { ...DEFAULT_STATE, ...initialState };
    this._onChange = onChange || (() => {});
    this._el = null;
    this._searchDebounce = null;
    this._unsubCart = null;
    // Per-section filter visibility (shop redesign step 3). null section maps
    // to the 'all' umbrella view.
    this._section = section || 'all';
    this._config  = FILTER_CONFIG[this._section] || FILTER_CONFIG.all;
    // Axis chip rows only render when at least one visible product has a value
    // for that axis. Keeps the filter panel clean as the catalogue pivots
    // between product categories (roof boxes → apparel → services).
    this._scanProducts(products);
  }

  // Recompute auto-detect flags + the visible subcategory set whenever the
  // product list changes (e.g. after _loadProducts in ShopView).
  _scanProducts(products) {
    this._hasShape    = products.some(p => p.shape != null);
    this._hasCapacity = products.some(p => p.capacity_litres != null);
    // Surface every distinct non-null subcategory as a chip on sections that
    // ask for it. Sorted alphabetically so the chip order is stable.
    const subs = new Set();
    for (const p of products) if (p.subcategory) subs.add(p.subcategory);
    this._availableSubcategories = [...subs].sort();
  }

  setProducts(products) {
    this._scanProducts(products);
    this._paint();
  }

  getState() { return { ...this._state }; }

  setState(patch) {
    this._state = { ...this._state, ...patch };
    this._paint();
    this._onChange(this.getState());
  }

  resetState() {
    this._state = { ...DEFAULT_STATE };
    this._paint();
    this._onChange(this.getState());
  }

  render() {
    const el = document.createElement('div');
    el.className = 'shop-filters';
    this._el = el;
    this._paint();
    // Repaint price placeholders when currency toggles elsewhere
    this._unsubCart = cart.subscribe(() => this._paint());
    return el;
  }

  _activeFilterCount() {
    const s = this._state;
    return ((s.shapes        && s.shapes.length)        ? 1 : 0) +
           ((s.capacities    && s.capacities.length)    ? 1 : 0) +
           ((s.durations     && s.durations.length)     ? 1 : 0) +
           ((s.formats       && s.formats.length)       ? 1 : 0) +
           ((s.subcategories && s.subcategories.length) ? 1 : 0) +
           ((s.priceMin || s.priceMax) ? 1 : 0) +
           (s.inStockOnly ? 1 : 0);
  }

  // Resolve a config flag — true ⇒ always show, false ⇒ always hide,
  // 'auto' ⇒ defer to a section-aware predicate. Anything else falls back
  // to 'false' so a future config key without a code branch fails closed.
  _shows(key, autoFn) {
    const v = this._config[key];
    if (v === true)  return true;
    if (v === 'auto') return !!autoFn();
    return false;
  }

  _paint() {
    if (!this._el) return;
    const s   = this._state;
    const cur = cart.getCurrency();
    const pricePlaceholder = cur === 'ISK' ? 'kr.' : '€';
    const shapes = SHAPE_IDS.map(id => ({ id, label: t('filters.shape.' + id) }));
    const sorts = [
      { id: 'featured',   label: t('filters.sort.featured') },
      { id: 'price-asc',  label: t('filters.sort.priceAsc') },
      { id: 'price-desc', label: t('filters.sort.priceDesc') },
      { id: 'newest',     label: t('filters.sort.newest') },
      { id: 'name',       label: t('filters.sort.name') },
    ];

    // Per-section visibility — resolved once per paint so the markup stays
    // a flat block of conditionals rather than a tree of nested ternaries.
    const showShape       = this._shows('shape',       () => this._hasShape);
    const showCapacity    = this._shows('capacity',    () => this._hasCapacity);
    const showDuration    = this._shows('duration',    () => true);
    const showFormat      = this._shows('format',      () => true);
    const showSubcategory = this._shows('subcategory', () => this._availableSubcategories.length > 0);
    const showStock       = this._shows('stock',       () => false);
    const showPrice       = this._shows('price',       () => false);

    this._el.innerHTML = `
      <div class="shop-filters__top">
        <div class="shop-filters__search">
          <svg class="shop-filters__search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
          <input type="search" id="shop-filters-q" class="shop-filters__input"
                 placeholder="${t('filters.searchPlaceholder')}" value="${_esc(s.q)}"
                 autocomplete="off" data-testid="shop-search"/>
          ${s.q ? `<button type="button" class="shop-filters__clear-search" id="shop-filters-clear-q"
                    aria-label="${t('shop.filtersClearSearchAria')}">✕</button>` : ''}
        </div>
        <label class="shop-filters__sort">
          <span class="shop-filters__sort-label">${t('filters.sort')}</span>
          <select id="shop-filters-sort" data-testid="shop-sort">
            ${sorts.map(o => `<option value="${o.id}" ${o.id === s.sort ? 'selected' : ''}>${o.label}</option>`).join('')}
          </select>
        </label>
      </div>

      ${showShape ? `
      <div class="shop-filters__row">
        <span class="shop-filters__row-label">${t('filters.shape')}</span>
        <div class="shop-filters__chips" role="group" aria-label="${t('filters.filterByShape')}">
          ${shapes.map(sh => `
            <button type="button" class="shop-filters__chip ${s.shapes.includes(sh.id) ? 'active' : ''}"
                    data-shape="${sh.id}" data-testid="shape-${sh.id}">${sh.label}</button>
          `).join('')}
        </div>
      </div>` : ''}

      ${showCapacity ? `
      <div class="shop-filters__row">
        <span class="shop-filters__row-label">${t('filters.capacity')}</span>
        <div class="shop-filters__chips" role="group" aria-label="${t('filters.filterByCapacity')}">
          ${CAPACITY_BUCKETS.map(b => `
            <button type="button" class="shop-filters__chip ${s.capacities.includes(b.id) ? 'active' : ''}"
                    data-cap="${b.id}" data-testid="cap-${b.id}">${t('filters.capacity.' + b.id)}</button>
          `).join('')}
        </div>
      </div>` : ''}

      ${showDuration ? `
      <div class="shop-filters__row">
        <span class="shop-filters__row-label">${t('filters.duration')}</span>
        <div class="shop-filters__chips" role="group" aria-label="${t('filters.filterByDuration')}">
          ${DURATION_BUCKETS.map(b => `
            <button type="button" class="shop-filters__chip ${s.durations.includes(b.id) ? 'active' : ''}"
                    data-duration="${b.id}" data-testid="dur-${b.id}">${t('filters.duration.' + b.id)}</button>
          `).join('')}
        </div>
      </div>` : ''}

      ${showFormat ? `
      <div class="shop-filters__row">
        <span class="shop-filters__row-label">${t('filters.format')}</span>
        <div class="shop-filters__chips" role="group" aria-label="${t('filters.filterByFormat')}">
          ${DELIVERY_FORMATS.map(f => `
            <button type="button" class="shop-filters__chip ${s.formats.includes(f) ? 'active' : ''}"
                    data-format="${f}" data-testid="fmt-${f}">${t('filters.format.' + f)}</button>
          `).join('')}
        </div>
      </div>` : ''}

      ${showSubcategory ? `
      <div class="shop-filters__row">
        <span class="shop-filters__row-label">${t('filters.subcategory')}</span>
        <div class="shop-filters__chips" role="group" aria-label="${t('filters.filterBySubcategory')}">
          ${this._availableSubcategories.map(sub => `
            <button type="button" class="shop-filters__chip ${s.subcategories.includes(sub) ? 'active' : ''}"
                    data-subcategory="${_esc(sub)}" data-testid="sub-${_esc(sub)}">${_esc(sub)}</button>
          `).join('')}
        </div>
      </div>` : ''}

      <div class="shop-filters__row shop-filters__row--wrap">
        ${showPrice ? `
        <span class="shop-filters__row-label">${t('filters.price')} (${cur})</span>
        <div class="shop-filters__price">
          <input type="number" inputmode="numeric" min="0" step="any"
                 class="shop-filters__price-input" id="shop-filters-min"
                 placeholder="${t('filters.minPrice')} ${pricePlaceholder}" value="${_esc(s.priceMin)}"
                 aria-label="${t('shop.filtersMinPriceAria')}"/>
          <span class="shop-filters__price-sep">—</span>
          <input type="number" inputmode="numeric" min="0" step="any"
                 class="shop-filters__price-input" id="shop-filters-max"
                 placeholder="${t('filters.maxPrice')} ${pricePlaceholder}" value="${_esc(s.priceMax)}"
                 aria-label="${t('shop.filtersMaxPriceAria')}"/>
        </div>` : ''}

        ${showStock ? `
        <label class="shop-filters__toggle">
          <input type="checkbox" id="shop-filters-stock" ${s.inStockOnly ? 'checked' : ''}/>
          <span>${t('filters.inStockOnly')}</span>
        </label>` : ''}

        ${this._activeFilterCount() > 0 || s.q || s.sort !== 'featured'
          ? `<button type="button" class="shop-filters__reset" id="shop-filters-reset"
                     data-testid="shop-filters-reset">${t('filters.clearAll')}</button>`
          : ''}
      </div>
    `;

    this._bind();
  }

  _bind() {
    const root = this._el;

    // Search (debounced)
    const q = root.querySelector('#shop-filters-q');
    q?.addEventListener('input', (e) => {
      const v = e.target.value;
      clearTimeout(this._searchDebounce);
      this._searchDebounce = setTimeout(() => {
        this._state.q = v;
        this._onChange(this.getState());
        // Re-render minimally — add/remove the clear button
        const hadBtn = !!root.querySelector('#shop-filters-clear-q');
        if ((!!v) !== hadBtn) this._paint();
      }, 120);
    });

    root.querySelector('#shop-filters-clear-q')?.addEventListener('click', () => {
      this.setState({ q: '' });
    });

    // Sort
    root.querySelector('#shop-filters-sort')?.addEventListener('change', (e) => {
      this.setState({ sort: e.target.value });
    });

    // Shape chips
    root.querySelectorAll('[data-shape]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.shape;
        const next = this._state.shapes.includes(id)
          ? this._state.shapes.filter(x => x !== id)
          : [...this._state.shapes, id];
        this.setState({ shapes: next });
      });
    });

    // Capacity chips
    root.querySelectorAll('[data-cap]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.cap;
        const next = this._state.capacities.includes(id)
          ? this._state.capacities.filter(x => x !== id)
          : [...this._state.capacities, id];
        this.setState({ capacities: next });
      });
    });

    // Shop redesign step 3 — service-axis chips. Same toggle pattern as
    // shape/capacity so multi-select state stays consistent.
    root.querySelectorAll('[data-duration]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.duration;
        const next = this._state.durations.includes(id)
          ? this._state.durations.filter(x => x !== id)
          : [...this._state.durations, id];
        this.setState({ durations: next });
      });
    });

    root.querySelectorAll('[data-format]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.format;
        const next = this._state.formats.includes(id)
          ? this._state.formats.filter(x => x !== id)
          : [...this._state.formats, id];
        this.setState({ formats: next });
      });
    });

    root.querySelectorAll('[data-subcategory]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.subcategory;
        const next = this._state.subcategories.includes(id)
          ? this._state.subcategories.filter(x => x !== id)
          : [...this._state.subcategories, id];
        this.setState({ subcategories: next });
      });
    });

    // Price min/max — commit on change (fires on blur / Enter) so typing doesn't
    // cause per-keystroke repaint/focus-loss. setState triggers a repaint so the
    // Reset button shows up immediately when a price filter becomes active.
    const commitPrice = (field, input) => {
      const v = input.value.trim();
      if (v !== this._state[field]) this.setState({ [field]: v });
    };
    const minEl = root.querySelector('#shop-filters-min');
    const maxEl = root.querySelector('#shop-filters-max');
    minEl?.addEventListener('change', () => commitPrice('priceMin', minEl));
    maxEl?.addEventListener('change', () => commitPrice('priceMax', maxEl));
    minEl?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); minEl.blur(); } });
    maxEl?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); maxEl.blur(); } });

    // In-stock toggle
    root.querySelector('#shop-filters-stock')?.addEventListener('change', (e) => {
      this.setState({ inStockOnly: e.target.checked });
    });

    // Reset
    root.querySelector('#shop-filters-reset')?.addEventListener('click', () => {
      this.resetState();
    });
  }

  destroy() {
    if (this._unsubCart) this._unsubCart();
    clearTimeout(this._searchDebounce);
  }
}

function _esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

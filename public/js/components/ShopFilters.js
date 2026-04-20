// ShopFilters — search, filter chips, and sort for the shop grid.
// Fully client-side: receives the full product list, emits filtered+sorted
// results + a URL-query-string representation via onChange.
import * as cart from '../services/cart.js';

const SHAPES = [
  { id: 'aero',    label: 'Aero' },
  { id: 'tall',    label: 'Tall' },
  { id: 'long',    label: 'Long' },
  { id: 'low',     label: 'Low-profile' },
  { id: 'cube',    label: 'Utility' },
  { id: 'classic', label: 'Classic' },
];

const CAPACITY_BUCKETS = [
  // Buckets are non-overlapping so a product never matches more than one.
  // "450L+" is inclusive (450 counts as 450L+).
  { id: 'under-350', label: 'Up to 349L', min: 0,   max: 349 },
  { id: '350-449',   label: '350–449L',   min: 350, max: 449 },
  { id: 'over-450',  label: '450L+',      min: 450, max: 99999 },
];

const SORTS = [
  { id: 'featured',   label: 'Featured' },
  { id: 'price-asc',  label: 'Price: low to high' },
  { id: 'price-desc', label: 'Price: high to low' },
  { id: 'newest',     label: 'Newest first' },
  { id: 'name',       label: 'Name A–Z' },
];

const DEFAULT_STATE = {
  q: '',
  shapes: [],        // array of shape ids
  capacities: [],    // array of bucket ids
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
  if (p.has('min'))    state.priceMin = p.get('min');
  if (p.has('max'))    state.priceMax = p.get('max');
  if (p.get('stock') === '1') state.inStockOnly = true;
  if (p.has('sort'))   state.sort = p.get('sort');
  return state;
}

export function stateToQs(state) {
  const p = new URLSearchParams();
  if (state.q) p.set('q', state.q);
  if (state.shapes.length) p.set('shapes', state.shapes.join(','));
  if (state.capacities.length) p.set('cap', state.capacities.join(','));
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

  if (state.shapes.length) {
    const s = new Set(state.shapes);
    out = out.filter(p => p.shape && s.has(p.shape));
  }

  if (state.capacities.length) {
    const buckets = CAPACITY_BUCKETS.filter(b => state.capacities.includes(b.id));
    out = out.filter(p => {
      if (!p.capacity_litres) return false;
      return buckets.some(b => p.capacity_litres >= b.min && p.capacity_litres <= b.max);
    });
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
  constructor({ initialState = {}, products = [], onChange } = {}) {
    this._state = { ...DEFAULT_STATE, ...initialState };
    this._onChange = onChange || (() => {});
    this._el = null;
    this._searchDebounce = null;
    this._unsubCart = null;
    // Axis chip rows only render when at least one visible product has a value
    // for that axis. Keeps the filter panel clean as the catalogue pivots
    // between product categories (roof boxes → apparel → …).
    this._hasShape    = products.some(p => p.shape != null);
    this._hasCapacity = products.some(p => p.capacity_litres != null);
  }

  setProducts(products) {
    this._hasShape    = products.some(p => p.shape != null);
    this._hasCapacity = products.some(p => p.capacity_litres != null);
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
    return (s.shapes.length ? 1 : 0) +
           (s.capacities.length ? 1 : 0) +
           ((s.priceMin || s.priceMax) ? 1 : 0) +
           (s.inStockOnly ? 1 : 0);
  }

  _paint() {
    if (!this._el) return;
    const s   = this._state;
    const cur = cart.getCurrency();
    const pricePlaceholder = cur === 'ISK' ? 'kr.' : '€';

    this._el.innerHTML = `
      <div class="shop-filters__top">
        <div class="shop-filters__search">
          <svg class="shop-filters__search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
          <input type="search" id="shop-filters-q" class="shop-filters__input"
                 placeholder="Search roof boxes" value="${_esc(s.q)}"
                 autocomplete="off" data-testid="shop-search"/>
          ${s.q ? `<button type="button" class="shop-filters__clear-search" id="shop-filters-clear-q"
                    aria-label="Clear search">✕</button>` : ''}
        </div>
        <label class="shop-filters__sort">
          <span class="shop-filters__sort-label">Sort</span>
          <select id="shop-filters-sort" data-testid="shop-sort">
            ${SORTS.map(o => `<option value="${o.id}" ${o.id === s.sort ? 'selected' : ''}>${o.label}</option>`).join('')}
          </select>
        </label>
      </div>

      ${this._hasShape ? `
      <div class="shop-filters__row">
        <span class="shop-filters__row-label">Shape</span>
        <div class="shop-filters__chips" role="group" aria-label="Filter by shape">
          ${SHAPES.map(sh => `
            <button type="button" class="shop-filters__chip ${s.shapes.includes(sh.id) ? 'active' : ''}"
                    data-shape="${sh.id}" data-testid="shape-${sh.id}">${sh.label}</button>
          `).join('')}
        </div>
      </div>` : ''}

      ${this._hasCapacity ? `
      <div class="shop-filters__row">
        <span class="shop-filters__row-label">Capacity</span>
        <div class="shop-filters__chips" role="group" aria-label="Filter by capacity">
          ${CAPACITY_BUCKETS.map(b => `
            <button type="button" class="shop-filters__chip ${s.capacities.includes(b.id) ? 'active' : ''}"
                    data-cap="${b.id}" data-testid="cap-${b.id}">${b.label}</button>
          `).join('')}
        </div>
      </div>` : ''}

      <div class="shop-filters__row shop-filters__row--wrap">
        <span class="shop-filters__row-label">Price (${cur})</span>
        <div class="shop-filters__price">
          <input type="number" inputmode="numeric" min="0" step="any"
                 class="shop-filters__price-input" id="shop-filters-min"
                 placeholder="Min ${pricePlaceholder}" value="${_esc(s.priceMin)}"
                 aria-label="Minimum price"/>
          <span class="shop-filters__price-sep">—</span>
          <input type="number" inputmode="numeric" min="0" step="any"
                 class="shop-filters__price-input" id="shop-filters-max"
                 placeholder="Max ${pricePlaceholder}" value="${_esc(s.priceMax)}"
                 aria-label="Maximum price"/>
        </div>

        <label class="shop-filters__toggle">
          <input type="checkbox" id="shop-filters-stock" ${s.inStockOnly ? 'checked' : ''}/>
          <span>In stock only</span>
        </label>

        ${this._activeFilterCount() > 0 || s.q || s.sort !== 'featured'
          ? `<button type="button" class="shop-filters__reset" id="shop-filters-reset"
                     data-testid="shop-filters-reset">Clear all</button>`
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

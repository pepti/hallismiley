// ProductView — product detail page. Route: #/shop/:slug
// Renders a variant picker when the product has variant_axes. The selected
// variant drives displayed price + stock + add-to-cart target.
//
// Inline editing (admin/moderator):
//   • Product name + description edit via PATCH /api/v1/admin/shop/products/:id
//   • Shared chrome labels (back link, VAT note, qty label, add-to-cart button
//     text, stock copy templates) edit via PUT /api/v1/content/shop_product_chrome
//   Both save in one go when the admin clicks Save.
import * as cart from '../services/cart.js';
import { CurrencySelector } from '../components/CurrencySelector.js';
import { LOW_STOCK_THRESHOLD } from '../components/ProductCard.js';
import { isAdmin, getCSRFToken } from '../services/auth.js';
import { t, href, adminLocaleBadgeHtml, checkUntranslated } from '../i18n/i18n.js';

// Default chrome — rendered when shop_product_chrome is missing or network fails.
// Templates use {n} (stock count) — substituted client-side.
const DEFAULT_CHROME = {
  back_label:          '← Back to shop',
  vat_note:            'Price includes 24% VAT',
  qty_label:           'Quantity',
  add_to_cart_label:   'Add to cart',
  out_of_stock_label:  'Out of stock',
  low_stock_template:  'Only {n} left — ships within 24 h',
  in_stock_template:   '{n} in stock',
  select_options_hint: 'Select options to see availability',
};

function _tpl(template, vars) {
  return String(template).replace(/\{(\w+)\}/g, (_, k) => vars[k] != null ? String(vars[k]) : '');
}

function _esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Label map for nicer chip text.
const AXIS_LABELS = { size: 'Size', color: 'Colour' };
const COLOR_LABELS = { black: 'Black', white: 'White' };

// Natural ordering for known axes. Any value not in the list gets a high index
// so it falls to the end (but alphabetically among its peers).
const AXIS_ORDER = {
  size:  ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'],
  color: ['black', 'white'],
};

function axisLabel(axis) {
  return AXIS_LABELS[axis] || (axis.charAt(0).toUpperCase() + axis.slice(1));
}

function axisValues(product, axis) {
  const seen = new Set();
  const values = [];
  for (const v of (product.variants || [])) {
    if (!v.active) continue;
    const val = v.attributes?.[axis];
    if (val != null && !seen.has(val)) {
      seen.add(val);
      values.push(val);
    }
  }
  const order = AXIS_ORDER[axis];
  if (order) {
    values.sort((a, b) => {
      const ai = order.indexOf(a);
      const bi = order.indexOf(b);
      const aRank = ai === -1 ? Number.MAX_SAFE_INTEGER : ai;
      const bRank = bi === -1 ? Number.MAX_SAFE_INTEGER : bi;
      return aRank - bRank || String(a).localeCompare(String(b));
    });
  }
  return values;
}

// Find the unique variant (if any) matching a full attribute selection.
function findVariant(product, selection) {
  return (product.variants || []).find(v => {
    if (!v.active) return false;
    return Object.entries(selection).every(([k, val]) => v.attributes?.[k] === val);
  }) || null;
}

export class ProductView {
  constructor(slug) {
    this._slug = slug;
    this._view = null;
    this._product = null;
    this._currencySelector = null;
    this._unsub = null;
    this._activeImageIdx = 0;

    // Variant selection state: { size: 'M', color: 'black' }. Populated with
    // the first available value on each axis for a smooth default.
    this._selection = {};

    // Shared chrome labels — loaded from site_content/shop_product_chrome.
    this._chrome = { ...DEFAULT_CHROME };

    // Edit-mode snapshots for Cancel.
    this._productSnapshot = null;
    this._chromeSnapshot  = null;
  }

  async render() {
    this._view = document.createElement('div');
    this._view.className = 'view shop-product';
    // Wrap the content in a body div so we can replace only the body on
    // re-paint and keep the floating edit button + controls untouched.
    this._view.innerHTML = `<div id="shop-product-body"><div class="shop-product__loading">${t('form.loading')}</div></div>`;

    try {
      // Product detail + shared chrome load in parallel. The chrome loader
      // has the side effect of setting this._chrome — we await it here but
      // don't need its return value, hence the underscore-prefixed name.
      const [productRes, _chromeLoaded] = await Promise.all([
        fetch(`/api/v1/shop/products/${encodeURIComponent(this._slug)}`, { credentials: 'include' }),
        this._loadChrome(),
      ]);
      void _chromeLoaded;
      const data = await productRes.json();
      if (!productRes.ok) throw new Error(data.error || 'Product not found');
      this._product = data.product;
      // Sensible default selection: first value on each axis.
      for (const axis of (this._product.variant_axes || [])) {
        this._selection[axis] = axisValues(this._product, axis)[0];
      }
    } catch (err) {
      const body = this._view.querySelector('#shop-product-body') || this._view;
      body.innerHTML = `
        <div class="shop-product__error">
          <p>${_esc(err.message)}</p>
          <a href="${href('/shop')}" class="shop-product__back">${_esc(this._chrome.back_label)}</a>
        </div>`;
      return this._view;
    }

    this._paint();
    this._unsub = cart.subscribe(() => this._updatePriceAndStock());
    this._initPageEdit(this._view);
    return this._view;
  }

  async _loadChrome() {
    try {
      const res = await fetch(`/api/v1/content/shop_product_chrome?locale=${encodeURIComponent(window.__locale || 'en')}`);
      if (res.ok) {
        const data = await res.json();
        this._chrome = this._mergeWithDefaults(DEFAULT_CHROME, data);
        return;
      }
    } catch { /* fall through */ }
    this._chrome = { ...DEFAULT_CHROME };
  }

  _mergeWithDefaults(defaults, data) {
    const out = JSON.parse(JSON.stringify(defaults));
    if (!data || typeof data !== 'object') return out;
    for (const [k, v] of Object.entries(data)) {
      if (v !== null && v !== undefined && v !== '') out[k] = v;
    }
    return out;
  }

  _selectedVariant() {
    const axes = this._product.variant_axes || [];
    if (axes.length === 0) return null;
    // Fully selected only when every axis has a value.
    for (const a of axes) {
      if (this._selection[a] == null) return null;
    }
    return findVariant(this._product, this._selection);
  }

  _effectivePrice(currency) {
    const v = this._selectedVariant();
    const field = currency === 'ISK' ? 'price_isk' : 'price_eur';
    if (v && v[field] != null) return v[field];
    return this._product[field];
  }

  _effectiveStock() {
    const v = this._selectedVariant();
    if (v) return Number(v.stock);
    // Fallback for single-SKU products
    return Number(this._product.stock);
  }

  _paint() {
    const p = this._product;
    const cover = p.images?.[this._activeImageIdx]?.url || p.images?.[0]?.url || '';
    const axes = p.variant_axes || [];
    const hasVariants = axes.length > 0;

    const c = this._chrome;
    const body = this._view.querySelector('#shop-product-body');

    body.innerHTML = `
      <div class="shop-product__inner" data-section="product">
        <a href="${href('/shop')}" class="shop-product__back" data-chrome-field="back_label">${_esc(c.back_label)}</a>
        <div class="shop-product__grid">
          <div class="shop-product__gallery">
            <div class="shop-product__cover" id="shop-cover">
              ${cover
                ? `<img src="${_esc(cover)}" alt="${_esc(p.name)}"/>`
                : `<div class="shop-product__placeholder">No image</div>`}
            </div>
            ${(p.images || []).length > 1 ? `
              <div class="shop-product__thumbs" id="shop-thumbs">
                ${p.images.map((img, i) => `
                  <button type="button" class="shop-product__thumb ${i === this._activeImageIdx ? 'active' : ''}"
                          data-idx="${i}" aria-label="Image ${i + 1}">
                    <img src="${_esc(img.url)}" alt=""/>
                  </button>
                `).join('')}
              </div>` : ''}
          </div>

          <div class="shop-product__body">
            <h1 class="shop-product__name" data-product-field="name">${_esc(p.name)}</h1>
            <div class="shop-product__currency" id="shop-currency"></div>
            <p class="shop-product__price" id="shop-price"></p>
            <p class="shop-product__vat" data-chrome-field="vat_note">${_esc(c.vat_note)}</p>
            <div class="shop-product__description" data-product-field="description">${_esc(p.description).replace(/\n/g, '<br/>')}</div>

            ${hasVariants ? axes.map(axis => `
              <div class="shop-product__variant" data-axis="${_esc(axis)}">
                <p class="shop-product__variant-label">${_esc(axisLabel(axis))}</p>
                <div class="shop-product__variant-chips" role="group" aria-label="Select ${_esc(axisLabel(axis))}">
                  ${axisValues(p, axis).map(val => this._variantChipHtml(axis, val)).join('')}
                </div>
              </div>
            `).join('') : ''}

            <div class="shop-product__stock" id="shop-stock" data-testid="stock-state"></div>

            <div class="shop-product__actions">
              <label for="shop-qty" class="shop-product__qty-label"
                     data-chrome-field="qty_label">${_esc(c.qty_label)}</label>
              <input type="number" id="shop-qty" min="1" value="1"
                     class="shop-product__qty"/>
              <button id="shop-add-btn" type="button" class="shop-product__add-btn"
                      data-chrome-field="add_to_cart_label"
                      data-testid="add-to-cart">${_esc(c.add_to_cart_label)}</button>
            </div>

            <p class="shop-product__confirm" id="shop-add-confirm" aria-live="polite"></p>

            <details class="shop-product__chrome-edit-hint shop-product__edit-only">
              <summary>Shared labels (affect all product pages)</summary>
              <div class="shop-product__chrome-edit-grid">
                <label>Out-of-stock text
                  <span data-chrome-field="out_of_stock_label">${_esc(c.out_of_stock_label)}</span>
                </label>
                <label>Low-stock template (use <code>{n}</code> for count)
                  <span data-chrome-field="low_stock_template">${_esc(c.low_stock_template)}</span>
                </label>
                <label>In-stock template (use <code>{n}</code> for count)
                  <span data-chrome-field="in_stock_template">${_esc(c.in_stock_template)}</span>
                </label>
                <label>Select-options hint
                  <span data-chrome-field="select_options_hint">${_esc(c.select_options_hint)}</span>
                </label>
              </div>
            </details>
          </div>
        </div>
      </div>
    `;

    this._currencySelector = new CurrencySelector({ onChange: () => this._updatePriceAndStock() });
    this._view.querySelector('#shop-currency').appendChild(this._currencySelector.render());

    // Variant chip clicks
    this._view.querySelectorAll('[data-axis] .shop-product__variant-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        const axis = btn.closest('[data-axis]').dataset.axis;
        const value = btn.dataset.value;
        this._selection[axis] = value;
        // Re-render to update the "active" styling + price/stock/disabled states
        this._repaintChips();
        this._updatePriceAndStock();
      });
    });

    // Thumbnails — swap the cover image + active thumb without a full re-paint
    // (avoids re-running all the chip/add-to-cart wiring for a trivial change).
    const thumbs = this._view.querySelector('#shop-thumbs');
    if (thumbs) {
      thumbs.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-idx]');
        if (!btn) return;
        this._activeImageIdx = Number(btn.dataset.idx);
        const coverEl = this._view.querySelector('#shop-cover');
        const newUrl = this._product.images?.[this._activeImageIdx]?.url;
        if (coverEl && newUrl) {
          coverEl.innerHTML = `<img src="${_esc(newUrl)}" alt="${_esc(this._product.name)}"/>`;
        }
        thumbs.querySelectorAll('[data-idx]').forEach(b =>
          b.classList.toggle('active', Number(b.dataset.idx) === this._activeImageIdx)
        );
      });
    }

    // Add to cart
    const addBtn = this._view.querySelector('#shop-add-btn');
    addBtn?.addEventListener('click', () => {
      const variant = this._selectedVariant();
      if (hasVariants && !variant) {
        const confirm = this._view.querySelector('#shop-add-confirm');
        confirm.textContent = t('shop.selectAllOptions');
        return;
      }
      const stock = this._effectiveStock();
      if (stock === 0) return;
      const qtyInput = this._view.querySelector('#shop-qty');
      const qty = Math.max(1, Math.min(stock, Math.floor(Number(qtyInput.value) || 1)));
      cart.add(p, variant, qty);
      const confirm = this._view.querySelector('#shop-add-confirm');
      const label = variant ? `${p.name} — ${variant.attributes.color ? (COLOR_LABELS[variant.attributes.color] || variant.attributes.color) : ''}${variant.attributes.size ? ' / ' + variant.attributes.size : ''}` : p.name;
      confirm.textContent = t('shop.addedToCart', { qty, label });
    });

    this._updatePriceAndStock();
  }

  _variantChipHtml(axis, value) {
    const active = this._selection[axis] === value;
    // Disable the chip if no active variant exists for this value given the
    // currently selected OTHER axes (prevents impossible combinations).
    const probe = { ...this._selection, [axis]: value };
    const hasMatch = (this._product.variants || []).some(v =>
      v.active && Object.entries(probe).every(([k, val]) => v.attributes?.[k] === val)
    );
    const disabled = !hasMatch;
    const label = axis === 'color' ? (COLOR_LABELS[value] || value) : String(value).toUpperCase();
    const classes = [
      'shop-product__variant-chip',
      active ? 'active' : '',
      disabled ? 'disabled' : '',
      axis === 'color' ? `shop-product__variant-chip--${value}` : '',
    ].filter(Boolean).join(' ');
    return `<button type="button" class="${classes}"
                    data-value="${_esc(value)}"
                    data-testid="variant-${_esc(axis)}-${_esc(value)}"
                    ${disabled ? 'disabled' : ''}>${_esc(label)}</button>`;
  }

  _repaintChips() {
    const axes = this._product.variant_axes || [];
    for (const axis of axes) {
      const row = this._view.querySelector(`[data-axis="${axis}"] .shop-product__variant-chips`);
      if (!row) continue;
      row.innerHTML = axisValues(this._product, axis).map(val => this._variantChipHtml(axis, val)).join('');
      row.querySelectorAll('.shop-product__variant-chip').forEach(btn => {
        btn.addEventListener('click', () => {
          this._selection[axis] = btn.dataset.value;
          this._repaintChips();
          this._updatePriceAndStock();
        });
      });
    }
  }

  _updatePriceAndStock() {
    if (!this._view || !this._product) return;
    const cur = cart.getCurrency();
    const priceEl = this._view.querySelector('#shop-price');
    const stockEl = this._view.querySelector('#shop-stock');
    const addBtn  = this._view.querySelector('#shop-add-btn');
    const qtyInp  = this._view.querySelector('#shop-qty');

    const price = this._effectivePrice(cur);
    if (priceEl) priceEl.textContent = cart.formatMoney(price, cur);

    const stock = this._effectiveStock();
    const axes = this._product.variant_axes || [];
    const fullySelected = axes.every(a => this._selection[a] != null);

    const c = this._chrome;

    if (axes.length > 0 && !fullySelected) {
      stockEl.innerHTML = `<span class="shop-product__stock--pending">${_esc(c.select_options_hint)}</span>`;
      if (addBtn) addBtn.disabled = true;
      if (qtyInp) qtyInp.disabled = true;
      return;
    }
    if (stock === 0) {
      stockEl.innerHTML = `<span class="shop-product__stock--out" data-testid="stock-out">${_esc(c.out_of_stock_label)}</span>`;
      if (addBtn) { addBtn.disabled = true; addBtn.textContent = c.out_of_stock_label; }
      if (qtyInp) qtyInp.disabled = true;
      return;
    }
    if (stock <= LOW_STOCK_THRESHOLD) {
      stockEl.innerHTML = `<span class="shop-product__stock--low" data-testid="stock-low">${_esc(_tpl(c.low_stock_template, { n: stock }))}</span>`;
    } else {
      stockEl.innerHTML = `<span class="shop-product__stock--in">${_esc(_tpl(c.in_stock_template, { n: stock }))}</span>`;
    }
    if (addBtn) { addBtn.disabled = false; addBtn.textContent = c.add_to_cart_label; }
    if (qtyInp) { qtyInp.disabled = false; qtyInp.max = String(stock); }
  }

  // ── Inline edit (admin only: product name/description PATCH uses admin role;
  //                admin/moderator: chrome PUT uses content pattern) ────────
  _initPageEdit(view) {
    // Product name/description edits hit an admin-only endpoint, so we only
    // show the edit button to full admins. A moderator can still edit
    // shop_product_chrome via ShopView's hero editor (same role there),
    // but we don't open the inline product-name editor for moderators here
    // to avoid save failures on the product PATCH.
    if (!isAdmin()) return;

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'shop-view__edit-btn';
    editBtn.setAttribute('data-testid', 'edit-product-page-btn');
    editBtn.textContent = t('admin.editProduct');
    view.appendChild(editBtn);

    const controls = document.createElement('div');
    controls.className = 'shop-view__edit-controls shop-view__edit-controls--hidden';
    controls.innerHTML = `
      ${adminLocaleBadgeHtml()}
      <button type="button" class="shop-view__save-btn"
              data-testid="edit-product-page-save">${t('form.saveChanges')}</button>
      <button type="button" class="shop-view__cancel-btn"
              data-testid="edit-product-page-cancel">${t('admin.cancel')}</button>
      <span class="shop-view__edit-status" aria-live="polite"></span>`;
    view.appendChild(controls);

    editBtn.addEventListener('click', () => {
      this._productSnapshot = { name: this._product.name, description: this._product.description };
      this._chromeSnapshot  = JSON.parse(JSON.stringify(this._chrome));
      this._enterEdit(view, editBtn, controls);
    });

    controls.querySelector('.shop-view__save-btn').addEventListener('click', () =>
      this._saveAll(view, editBtn, controls)
    );

    controls.querySelector('.shop-view__cancel-btn').addEventListener('click', () => {
      if (this._productSnapshot) {
        this._product.name = this._productSnapshot.name;
        this._product.description = this._productSnapshot.description;
      }
      if (this._chromeSnapshot) this._chrome = this._chromeSnapshot;
      this._paint();
      this._updatePriceAndStock();
      this._exitEdit(view, editBtn, controls);
    });
  }

  _enterEdit(view, editBtn, controls) {
    view.classList.add('shop-view--editing');
    editBtn.classList.add('shop-view__edit-btn--hidden');
    controls.classList.remove('shop-view__edit-controls--hidden');
    checkUntranslated('shop_product_chrome', controls);
    view.querySelectorAll('[data-product-field], [data-chrome-field]').forEach(el => {
      el.contentEditable = 'true';
      el.spellcheck = true;
    });
  }

  _exitEdit(view, editBtn, controls) {
    view.classList.remove('shop-view--editing');
    editBtn.classList.remove('shop-view__edit-btn--hidden');
    controls.classList.add('shop-view__edit-controls--hidden');
    controls.querySelector('.shop-view__edit-status').textContent = '';
    view.querySelectorAll('[data-product-field], [data-chrome-field]').forEach(el => {
      el.contentEditable = 'false';
      el.removeAttribute('contenteditable');
    });
  }

  _readField(root, selector, fallback) {
    const el = root.querySelector(selector);
    return (el?.innerText || '').trim() || fallback;
  }

  async _saveAll(view, editBtn, controls) {
    const status = controls.querySelector('.shop-view__edit-status');
    status.textContent = t('form.saving');

    // Collect the two payloads from the DOM.
    const nameEl  = view.querySelector('[data-product-field="name"]');
    const descEl  = view.querySelector('[data-product-field="description"]');
    // Use textContent rather than innerText so CSS text-transform doesn't
    // alter persisted copy. For the description we keep innerText because
    // we want the line breaks the user typed, then normalise to \n.
    const nextName = (nameEl?.textContent || '').trim() || this._product.name;
    const nextDesc = ((descEl?.innerText || '').trim() || this._product.description).replace(/\r\n?/g, '\n');

    const chromePayload = { ...this._chrome };
    for (const key of Object.keys(DEFAULT_CHROME)) {
      const el = view.querySelector(`[data-chrome-field="${key}"]`);
      if (!el) continue;
      const v = (el.textContent || '').trim();
      chromePayload[key] = v || DEFAULT_CHROME[key];
    }

    let token = null;
    try { token = await getCSRFToken(); } catch { /* fine */ }
    const headers = {
      'Content-Type': 'application/json',
      ...(token ? { 'X-CSRF-Token': token } : {}),
    };

    // Run both saves in parallel; collect results so one failure doesn't hide the other.
    const productSave = fetch(`/api/v1/admin/shop/products/${this._product.id}`, {
      method: 'PATCH',
      credentials: 'include',
      headers,
      body: JSON.stringify({ name: nextName, description: nextDesc }),
    }).then(async r => {
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(`Product: ${data.error || r.statusText}`);
      return data.product;
    });

    const chromeSave = fetch(`/api/v1/content/shop_product_chrome?locale=${encodeURIComponent(window.__locale || 'en')}`, {
      method: 'PUT',
      credentials: 'include',
      headers,
      body: JSON.stringify(chromePayload),
    }).then(async r => {
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(`Chrome: ${data.error || r.statusText}`);
      return data;
    });

    const [prodRes, chromeRes] = await Promise.allSettled([productSave, chromeSave]);
    const errs = [];
    if (prodRes.status === 'fulfilled') {
      // Apply the server-normalised values, re-render everything.
      this._product.name = prodRes.value.name;
      this._product.description = prodRes.value.description;
    } else {
      errs.push(prodRes.reason.message);
    }
    if (chromeRes.status === 'fulfilled') {
      this._chrome = this._mergeWithDefaults(DEFAULT_CHROME, chromeRes.value);
    } else {
      errs.push(chromeRes.reason.message);
    }

    this._paint();
    this._updatePriceAndStock();

    if (errs.length) {
      status.textContent = `Saved with errors — ${errs.join('; ')}`;
      return;
    }
    status.textContent = t('form.saved');
    setTimeout(() => this._exitEdit(view, editBtn, controls), 900);
  }

  destroy() {
    if (this._currencySelector) this._currencySelector.destroy();
    if (this._unsub) this._unsub();
  }
}

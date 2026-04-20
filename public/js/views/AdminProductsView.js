// AdminProductsView — admin CRUD for products. Route: #/admin/shop/products
import { getCSRFToken, getCsrfHeaders } from '../utils/api.js';
import * as cart from '../services/cart.js';

function _esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export class AdminProductsView {
  constructor() { this._view = null; this._products = []; }

  async render() {
    this._view = document.createElement('div');
    this._view.className = 'view admin-shop';
    this._view.innerHTML = `
      <div class="admin-shop__inner">
        <header class="admin-shop__header">
          <h1>Manage products</h1>
          <button type="button" id="admin-new-product" class="admin-shop__primary-btn">+ New product</button>
        </header>
        <p class="admin-shop__hint">
          ISK prices are whole krónur (e.g. <code>89000</code>). EUR prices are in <em>cents</em>
          (e.g. <code>60000</code> for €600.00). Prices are VAT-inclusive (24% VSK).
        </p>
        <div id="admin-shop-body"><p>Loading…</p></div>
      </div>
    `;
    this._view.querySelector('#admin-new-product').addEventListener('click', () => this._showForm());

    await this._load();
    return this._view;
  }

  async _load() {
    try {
      const res = await fetch('/api/v1/admin/shop/products', { credentials: 'include' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load products');
      this._products = data.products || [];
      this._paint();
    } catch (err) {
      this._view.querySelector('#admin-shop-body').innerHTML =
        `<p class="admin-shop__error">${_esc(err.message)}</p>`;
    }
  }

  _paint() {
    const body = this._view.querySelector('#admin-shop-body');
    if (this._products.length === 0) {
      body.innerHTML = `<p>No products yet. Click "+ New product" to add one.</p>`;
      return;
    }
    body.innerHTML = `
      <table class="admin-shop__table">
        <thead><tr>
          <th>Image</th><th>Name</th><th>Slug</th>
          <th>Price ISK</th><th>Price EUR</th>
          <th>Stock</th><th>Active</th><th></th>
        </tr></thead>
        <tbody>
          ${this._products.map(p => `
            <tr data-id="${_esc(p.id)}">
              <td>${p.images?.[0]?.url
                ? `<img class="admin-shop__thumb" src="${_esc(p.images[0].url)}" alt=""/>`
                : '<span class="admin-shop__thumb admin-shop__thumb--placeholder"></span>'}</td>
              <td>${_esc(p.name)}</td>
              <td><code>${_esc(p.slug)}</code></td>
              <td>${cart.formatMoney(p.price_isk, 'ISK')}</td>
              <td>${cart.formatMoney(p.price_eur, 'EUR')}</td>
              <td>${p.stock}</td>
              <td>${p.active ? '✓' : '—'}</td>
              <td>
                <button type="button" class="admin-shop__link" data-action="edit" data-id="${_esc(p.id)}">Edit</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    `;
    body.querySelectorAll('[data-action="edit"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const p = this._products.find(x => x.id === btn.dataset.id);
        if (p) this._showForm(p);
      });
    });
  }

  _showForm(existing = null) {
    const isEdit = !!existing;
    const modal = document.createElement('div');
    modal.className = 'admin-shop__modal';
    modal.innerHTML = `
      <div class="admin-shop__modal-card">
        <header>
          <h2>${isEdit ? 'Edit product' : 'New product'}</h2>
          <button type="button" class="admin-shop__modal-close" aria-label="Close">✕</button>
        </header>
        <form class="admin-shop__form" id="admin-product-form">
          <label>Name
            <input type="text" name="name" required maxlength="200" value="${_esc(existing?.name || '')}"/>
          </label>
          <label>Slug (URL-friendly)
            <input type="text" name="slug" required pattern="[a-z0-9](?:[a-z0-9-]{0,80}[a-z0-9])?"
                   value="${_esc(existing?.slug || '')}"/>
          </label>
          <label>Description
            <textarea name="description" rows="4">${_esc(existing?.description || '')}</textarea>
          </label>
          <div class="admin-shop__form-row">
            <label>Price ISK (whole kr.)
              <input type="number" name="price_isk" required min="1" step="1" value="${existing?.price_isk ?? ''}"/>
            </label>
            <label>Price EUR (cents)
              <input type="number" name="price_eur" required min="1" step="1" value="${existing?.price_eur ?? ''}"/>
            </label>
          </div>
          <div class="admin-shop__form-row">
            <label>Stock
              <input type="number" name="stock" min="0" step="1" value="${existing?.stock ?? 0}"/>
            </label>
            <label>Weight (grams, optional)
              <input type="number" name="weight_grams" min="0" step="1" value="${existing?.weight_grams ?? ''}"/>
            </label>
            <label class="admin-shop__checkbox">
              <input type="checkbox" name="active" ${existing?.active === false ? '' : 'checked'}/>
              Active
            </label>
          </div>
          <p class="admin-shop__error" id="admin-product-error" role="alert"></p>
          <div class="admin-shop__form-actions">
            ${isEdit ? '<button type="button" class="admin-shop__delete" id="admin-product-deactivate">Deactivate</button>' : ''}
            <button type="submit" class="admin-shop__primary-btn">${isEdit ? 'Save' : 'Create'}</button>
          </div>
        </form>

        ${isEdit ? `
          <section class="admin-shop__images">
            <h3>Images</h3>
            <div class="admin-shop__image-list" id="admin-product-images"></div>
            <label class="admin-shop__upload-btn">
              <input type="file" accept="image/jpeg,image/png,image/webp" id="admin-product-image-input"/>
              Upload image
            </label>
          </section>

          <section class="admin-shop__variants">
            <h3>Variants <span class="admin-shop__hint" style="margin:0 8px;font-size:12px">
              ${(existing.variants || []).length} SKUs</span></h3>
            <p class="admin-shop__hint">
              Override prices and stock per SKU. Leave price fields blank to inherit the base price.
            </p>
            <div id="admin-variant-table-wrap"></div>
          </section>` : ''}
      </div>
    `;
    document.body.appendChild(modal);

    const close = () => modal.remove();
    modal.querySelector('.admin-shop__modal-close').addEventListener('click', close);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

    const form = modal.querySelector('#admin-product-form');
    const errorEl = modal.querySelector('#admin-product-error');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorEl.textContent = '';
      const fd = new FormData(form);
      const body = {
        name:         String(fd.get('name') || '').trim(),
        slug:         String(fd.get('slug') || '').trim(),
        description:  String(fd.get('description') || ''),
        price_isk:    Number(fd.get('price_isk')),
        price_eur:    Number(fd.get('price_eur')),
        stock:        Number(fd.get('stock') || 0),
        active:       fd.get('active') === 'on',
      };
      const wg = fd.get('weight_grams');
      if (wg !== null && wg !== '') body.weight_grams = Number(wg);

      try {
        const headers = await getCsrfHeaders();
        const url = isEdit ? `/api/v1/admin/shop/products/${existing.id}` : '/api/v1/admin/shop/products';
        const method = isEdit ? 'PATCH' : 'POST';
        const res = await fetch(url, { method, credentials: 'include', headers, body: JSON.stringify(body) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Save failed');
        close();
        await this._load();
      } catch (err) {
        errorEl.textContent = err.message;
      }
    });

    if (isEdit) {
      const deactivateBtn = modal.querySelector('#admin-product-deactivate');
      deactivateBtn.addEventListener('click', async () => {
        if (!confirm('Deactivate this product? It will stop showing in the shop.')) return;
        try {
          const token = await getCSRFToken();
          const res = await fetch(`/api/v1/admin/shop/products/${existing.id}`, {
            method: 'DELETE', credentials: 'include', headers: { 'X-CSRF-Token': token || '' },
          });
          if (!res.ok && res.status !== 204) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || 'Deactivation failed');
          }
          close();
          await this._load();
        } catch (err) {
          errorEl.textContent = err.message;
        }
      });

      // Variant management
      this._paintVariants(modal, existing);

      // Image management
      this._paintImages(modal, existing);
      modal.querySelector('#admin-product-image-input').addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
          const token = await getCSRFToken();
          const fdata = new FormData();
          fdata.append('file', file);
          const res = await fetch(`/api/v1/admin/shop/products/${existing.id}/images`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'X-CSRF-Token': token || '' },
            body: fdata,
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Upload failed');
          // Refresh images
          const refreshed = await (await fetch(`/api/v1/admin/shop/products/${existing.id}`, { credentials: 'include' })).json();
          existing.images = refreshed.product.images;
          this._paintImages(modal, existing);
          e.target.value = '';
          await this._load();
        } catch (err) {
          errorEl.textContent = err.message;
        }
      });
    }
  }

  _paintImages(modal, product) {
    const list = modal.querySelector('#admin-product-images');
    if (!list) return;
    if (!product.images || product.images.length === 0) {
      list.innerHTML = `<p class="admin-shop__hint">No images yet.</p>`;
      return;
    }
    list.innerHTML = product.images.map(img => `
      <div class="admin-shop__image-item" data-img-id="${_esc(img.id)}">
        <img src="${_esc(img.url)}" alt=""/>
        <button type="button" class="admin-shop__image-del" data-img-id="${_esc(img.id)}">Delete</button>
      </div>
    `).join('');
    list.querySelectorAll('.admin-shop__image-del').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this image?')) return;
        try {
          const token = await getCSRFToken();
          const res = await fetch(
            `/api/v1/admin/shop/products/${product.id}/images/${btn.dataset.imgId}`,
            { method: 'DELETE', credentials: 'include', headers: { 'X-CSRF-Token': token || '' } }
          );
          if (!res.ok && res.status !== 204) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || 'Delete failed');
          }
          product.images = product.images.filter(i => i.id !== btn.dataset.imgId);
          this._paintImages(modal, product);
          await this._load();
        } catch (err) {
          const errorEl = modal.querySelector('#admin-product-error');
          errorEl.textContent = err.message;
        }
      });
    });
  }

  _paintVariants(modal, product) {
    const wrap = modal.querySelector('#admin-variant-table-wrap');
    if (!wrap) return;
    const variants = product.variants || [];
    if (variants.length === 0) {
      wrap.innerHTML = `<p class="admin-shop__hint">
        No variants yet. Variants are created via the seed script or the API
        (<code>POST /api/v1/admin/shop/products/${product.id}/variants</code>).
      </p>`;
      return;
    }
    // Detect the axes used by this product so the table has a consistent shape.
    const axes = Array.isArray(product.variant_axes) ? product.variant_axes : [];
    wrap.innerHTML = `
      <table class="admin-shop__variant-table">
        <thead>
          <tr>
            ${axes.map(a => `<th>${_esc(a.charAt(0).toUpperCase() + a.slice(1))}</th>`).join('')}
            <th>SKU</th>
            <th>Override ISK</th>
            <th>Override EUR</th>
            <th>Stock</th>
            <th>Active</th>
          </tr>
        </thead>
        <tbody>
          ${variants.map(v => `
            <tr data-variant-id="${_esc(v.id)}">
              ${axes.map(a => `<td>${_esc(v.attributes?.[a] ?? '—')}</td>`).join('')}
              <td><code style="font-size:12px">${_esc(v.sku)}</code></td>
              <td><input class="admin-shop__var-input" type="number" min="1" step="1"
                         data-field="price_isk" value="${v.price_isk ?? ''}" placeholder="inherit"/></td>
              <td><input class="admin-shop__var-input" type="number" min="1" step="1"
                         data-field="price_eur" value="${v.price_eur ?? ''}" placeholder="inherit"/></td>
              <td><input class="admin-shop__var-input" type="number" min="0" step="1"
                         data-field="stock" value="${v.stock}"/></td>
              <td><input type="checkbox" data-field="active" ${v.active ? 'checked' : ''}/></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      <p class="admin-shop__hint" id="admin-variant-status" aria-live="polite"></p>
    `;

    const commit = async (row, field, rawValue) => {
      const status = wrap.querySelector('#admin-variant-status');
      const variantId = row.dataset.variantId;
      // Compose payload: empty string on price fields → null (inherit).
      let value = rawValue;
      if (field === 'price_isk' || field === 'price_eur') {
        value = (rawValue === '' || rawValue == null) ? null : Number(rawValue);
      } else if (field === 'stock') {
        value = Number(rawValue);
      } else if (field === 'active') {
        value = Boolean(rawValue);
      }
      status.textContent = `Saving ${field}…`;
      status.style.color = 'var(--text-muted)';
      try {
        const headers = await getCsrfHeaders();
        const res = await fetch(
          `/api/v1/admin/shop/products/${product.id}/variants/${variantId}`,
          { method: 'PATCH', credentials: 'include', headers, body: JSON.stringify({ [field]: value }) }
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Save failed');
        // Update local cache so a subsequent paint doesn't revert.
        const idx = product.variants.findIndex(x => x.id === variantId);
        if (idx >= 0) product.variants[idx] = data.variant;
        status.textContent = `Saved ${field}.`;
        status.style.color = 'var(--success)';
      } catch (err) {
        status.textContent = err.message;
        status.style.color = 'var(--error)';
      }
    };

    wrap.querySelectorAll('tr[data-variant-id]').forEach(row => {
      row.querySelectorAll('.admin-shop__var-input').forEach(inp => {
        inp.addEventListener('change', () => commit(row, inp.dataset.field, inp.value));
      });
      const activeBox = row.querySelector('input[data-field=active]');
      activeBox?.addEventListener('change', () => commit(row, 'active', activeBox.checked));
    });
  }

  destroy() {}
}

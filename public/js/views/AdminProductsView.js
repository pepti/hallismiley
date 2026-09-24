// AdminProductsView — admin CRUD for products. Route: #/admin/shop/products
import { getCSRFToken, getCsrfHeaders } from '../utils/api.js';
import * as cart from '../services/cart.js';
import { t, href } from '../i18n/i18n.js';
import { BarcodeScanner } from '../components/BarcodeScanner.js';
import { renderAdminShell } from '../components/AdminSidebar.js';
import { thumbUrl } from '../utils/imageUrl.js';
import {
  adminExportProductsUrl, adminPreviewProductImport, adminApplyProductImport,
  adminBulkProducts, adminProductAdjustments, adminParseProductImportFile,
} from '../services/adminProducts.js';
import { showToast } from '../components/Toast.js';

// Reasons an admin may give for a stock change (server models/Inventory.js
// ADJUSTMENT_REASONS); the product form's default is 'correction'.
const STOCK_REASONS = ['correction', 'recount', 'received', 'damaged', 'returned', 'theft_loss', 'other'];

// Available is the headline; on hand + committed sit underneath whenever an
// order holds something (harvested from icelandicstore #243).
function inventoryCellHtml(p) {
  const onHand = Number(p.on_hand ?? p.stock) || 0;
  const committed = Number(p.committed) || 0;
  const available = p.available == null ? onHand - committed : Number(p.available);
  const detail = committed
    ? `<span class="prod-inv__detail">${_esc(t('adminProducts.invDetail', { onHand, committed }))}</span>`
    : '';
  return `<span class="prod-inv">${available}</span>${detail}`;
}

function _esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export class AdminProductsView {
  constructor() { this._view = null; this._products = []; this._detailCache = new Map(); this._selected = new Set(); }

  async render() {
    this._view = document.createElement('div');
    this._view.className = 'view admin-shop';
    this._view.innerHTML = `
      <div class="admin-shop__inner">
        <header class="admin-shop__header">
          <h1>${t('adminProducts.title')}</h1>
          <div class="admin-shop__header-actions">
            <button type="button" id="admin-products-export" class="admin-shop__primary-btn">${t('adminProducts.export')}</button>
            <button type="button" id="admin-products-import" class="admin-shop__primary-btn">${t('adminProducts.import')}</button>
            <button type="button" id="admin-new-product" class="admin-shop__primary-btn">${t('adminProducts.newProduct')}</button>
          </div>
        </header>
        <p class="admin-shop__hint">${t('adminProducts.priceHint')}</p>
        <div class="prod-bulkbar" id="prod-bulkbar" hidden></div>
        <div id="admin-shop-body"><p>${t('form.loading')}</p></div>
      </div>
    `;
    this._view.querySelector('#admin-new-product').addEventListener('click', () => this._showForm());
    this._view.querySelector('#admin-products-export').addEventListener('click', () => this._exportCsv());
    this._view.querySelector('#admin-products-import').addEventListener('click', () => this._openImportModal());

    await this._load();
    return renderAdminShell({ activePath: '/admin/shop/products', content: this._view });
  }

  async _load() {
    try {
      const res = await fetch('/api/v1/admin/shop/products', { credentials: 'include' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load products');
      this._products = data.products || [];
      const ids = new Set(this._products.map(p => p.id));
      for (const id of [...this._selected]) if (!ids.has(id)) this._selected.delete(id);
      this._paint();
    } catch (err) {
      this._view.querySelector('#admin-shop-body').innerHTML =
        `<p class="admin-shop__error">${_esc(err.message)}</p>`;
    }
  }

  _paint() {
    const body = this._view.querySelector('#admin-shop-body');
    if (this._products.length === 0) {
      body.innerHTML = `<p>${t('adminProducts.empty')}</p>`;
      return;
    }
    body.innerHTML = `
      <table class="admin-shop__table">
        <thead><tr>
          <th class="prod-select"><input type="checkbox" id="prod-select-all" aria-label="${_esc(t('adminProducts.selectAll'))}"
            ${this._products.length && this._products.every(p => this._selected.has(p.id)) ? 'checked' : ''}/></th>
          <th>${t('adminProducts.image')}</th><th>${t('adminProducts.name')}</th><th>${t('adminProducts.slug')}</th>
          <th>${t('adminProducts.priceISK')}</th><th>${t('adminProducts.priceEUR')}</th>
          <th>${t('adminProducts.stock')}</th><th>${t('adminProducts.active')}</th><th></th>
        </tr></thead>
        <tbody>
          ${this._products.map(p => `
            <tr data-id="${_esc(p.id)}">
              <td class="prod-select"><input type="checkbox" data-select="${_esc(p.id)}" ${this._selected.has(p.id) ? 'checked' : ''}
                    aria-label="${_esc(t('adminProducts.selectOne', { name: p.name }))}"/></td>
              <td>${p.images?.[0]?.url
                ? `<img class="admin-shop__thumb" src="${_esc(thumbUrl(p.images[0].url))}" alt="" loading="lazy"/>`
                : '<span class="admin-shop__thumb admin-shop__thumb--placeholder"></span>'}</td>
              <td><button type="button" class="prod-name" data-toggle="${_esc(p.id)}" aria-expanded="false"><span class="prod-name__chevron" aria-hidden="true">▸</span>${_esc(p.name)}</button></td>
              <td><code>${_esc(p.slug)}</code></td>
              <td>${cart.formatMoney(p.price_isk, 'ISK')}</td>
              <td>${cart.formatMoney(p.price_eur, 'EUR')}</td>
              <td>${inventoryCellHtml(p)}</td>
              <td>${p.active ? '✓' : '—'}</td>
              <td>
                <button type="button" class="admin-shop__link" data-action="edit" data-id="${_esc(p.id)}">${t('admin.edit')}</button>
              </td>
            </tr>
            <tr class="prod-detail-row" data-detail-for="${_esc(p.id)}" hidden><td colspan="9"><div class="prod-detail" data-detail-panel></div></td></tr>`).join('')}
        </tbody>
      </table>
    `;
    body.querySelectorAll('[data-action="edit"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const p = this._products.find(x => x.id === btn.dataset.id);
        if (p) this._showForm(p);
      });
    });
    body.querySelectorAll('.prod-name[data-toggle]').forEach(btn => {
      btn.addEventListener('click', () => this._toggleDetail(btn.dataset.toggle, btn));
    });
    body.querySelectorAll('[data-select]').forEach(box => {
      box.addEventListener('change', () => {
        if (box.checked) this._selected.add(box.dataset.select); else this._selected.delete(box.dataset.select);
        const all = body.querySelector('#prod-select-all');
        if (all) all.checked = this._products.every(p => this._selected.has(p.id));
        this._paintBulkBar();
      });
    });
    body.querySelector('#prod-select-all')?.addEventListener('change', (e) => {
      if (e.target.checked) this._products.forEach(p => this._selected.add(p.id));
      else this._selected.clear();
      body.querySelectorAll('[data-select]').forEach(b => { b.checked = e.target.checked; });
      this._paintBulkBar();
    });
    this._paintBulkBar();
  }

  // ── Bulk actions (harvested from icelandicstore #247) ────────────────────────
  _paintBulkBar() {
    const bar = this._view.querySelector('#prod-bulkbar');
    if (!bar) return;
    const n = this._selected.size;
    bar.hidden = n === 0;
    if (!n) { bar.innerHTML = ''; return; }
    bar.innerHTML = `
      <span class="prod-bulkbar__count">${_esc(t('adminProducts.nSelected', { n }))}</span>
      <div class="prod-bulkbar__actions">
        <button type="button" class="admin-shop__link" data-bulk="activate">${t('adminProducts.bulkActivate')}</button>
        <button type="button" class="admin-shop__link" data-bulk="deactivate">${t('adminProducts.bulkDeactivate')}</button>
        <button type="button" class="admin-shop__primary-btn" data-bulk="edit">${t('adminProducts.bulkEdit')}</button>
        <button type="button" class="admin-shop__link" data-bulk="clear">${t('adminProducts.clearSelection')}</button>
      </div>`;
    bar.querySelectorAll('[data-bulk]').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.bulk;
        if (action === 'clear') { this._selected.clear(); this._paint(); return; }
        if (action === 'edit') { this._openBulkEdit(); return; }
        this._runBulk(action);
      });
    });
  }

  async _runBulk(action, fields) {
    try {
      const { updated } = await adminBulkProducts([...this._selected], action, fields);
      showToast(t('adminProducts.bulkDone', { n: updated }), 'success');
      this._detailCache.clear();
      await this._load();
      return true;
    } catch (err) {
      showToast(err.message, 'error');
      return false;
    }
  }

  _openBulkEdit() {
    const n = this._selected.size;
    const modal = document.createElement('div');
    modal.className = 'admin-shop__modal';
    modal.innerHTML = `
      <div class="admin-shop__modal-card prod-bulkedit__card" role="dialog" aria-modal="true" aria-labelledby="prod-bulkedit-title">
        <header>
          <h2 id="prod-bulkedit-title">${_esc(t('adminProducts.bulkEditTitle', { n }))}</h2>
          <button type="button" class="admin-shop__modal-close" aria-label="${t('common.close')}">✕</button>
        </header>
        <p class="admin-shop__hint">${t('adminProducts.bulkEditHint')}</p>
        <form class="prod-bulkedit__form" id="prod-bulkedit-form">
          <label>${t('adminProducts.categoryLabel')}
            <select name="category">
              <option value="">${t('adminProducts.bulkKeep')}</option>
              <option value="product">${t('adminProducts.categoryProduct')}</option>
              <option value="tech_service">${t('adminProducts.categoryTech')}</option>
              <option value="carpentry_service">${t('adminProducts.categoryCarpentry')}</option>
            </select>
          </label>
          <label>${t('adminProducts.subcategoryLabel')}
            <input type="text" name="subcategory" maxlength="60" placeholder="${_esc(t('adminProducts.bulkKeep'))}"/>
          </label>
          <label>${t('adminProducts.vatRateLabel')}
            <select name="vat_rate">
              <option value="">${t('adminProducts.bulkKeep')}</option>
              ${[24, 11, 0].map(rt => `<option value="${rt}">${t(`adminProducts.vatRate${rt}`)}</option>`).join('')}
            </select>
          </label>
          <label>${t('adminProducts.bulkStatus')}
            <select name="active">
              <option value="">${t('adminProducts.bulkKeep')}</option>
              <option value="true">${t('adminProducts.active')}</option>
              <option value="false">${t('adminProducts.inactive')}</option>
            </select>
          </label>
          <label>${t('adminProducts.detailBin')}
            <input type="text" name="bin" maxlength="40" placeholder="${_esc(t('adminProducts.bulkKeep'))}"/>
          </label>
        </form>
        <p class="admin-shop__error" id="prod-bulkedit-error" role="alert"></p>
        <div class="prod-bulkedit__footer">
          <button type="button" class="admin-shop__link" data-close>${t('form.cancel')}</button>
          <button type="button" class="admin-shop__primary-btn" id="prod-bulkedit-apply">${_esc(t('adminProducts.bulkApply', { n }))}</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    const close = () => modal.remove();
    modal.querySelector('.admin-shop__modal-close').addEventListener('click', close);
    modal.querySelector('[data-close]').addEventListener('click', close);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    modal.querySelector('#prod-bulkedit-apply').addEventListener('click', async () => {
      const fd = new FormData(modal.querySelector('#prod-bulkedit-form'));
      const fields = {};
      for (const k of ['category', 'subcategory', 'bin']) {
        const v = String(fd.get(k) || '').trim();
        if (v) fields[k] = v;
      }
      if (fd.get('vat_rate')) fields.vat_rate = Number(fd.get('vat_rate'));
      if (fd.get('active')) fields.active = fd.get('active') === 'true';
      if (!Object.keys(fields).length) {
        modal.querySelector('#prod-bulkedit-error').textContent = t('adminProducts.bulkEditEmpty');
        return;
      }
      const btn = modal.querySelector('#prod-bulkedit-apply');
      btn.disabled = true;
      if (await this._runBulk('edit', fields)) close();
      else btn.disabled = false;
    });
  }

  // ── Inline detail panel (click a product name) ────────────────────────────────
  // Accordion: one panel open at a time. Distinct from the Edit modal — this is a
  // read-only summary (pricing, inventory, codes, per-variant table). Fetches the
  // full product once (cached per view) via the existing single-product GET.
  async _toggleDetail(id, btn) {
    const row = this._view.querySelector(`.prod-detail-row[data-detail-for="${id}"]`);
    if (!row) return;
    const wasOpen = !row.hidden;
    // Close every panel + reset every chevron (accordion).
    this._view.querySelectorAll('.prod-detail-row').forEach(r => { r.hidden = true; });
    this._view.querySelectorAll('.prod-name[aria-expanded="true"]').forEach(b => b.setAttribute('aria-expanded', 'false'));
    if (wasOpen) return; // it was open → this click closes it
    btn.setAttribute('aria-expanded', 'true');
    row.hidden = false;
    const panel = row.querySelector('[data-detail-panel]');
    let product = this._detailCache.get(id);
    if (!product) {
      panel.innerHTML = `<p class="admin-shop__hint">${t('form.loading')}</p>`;
      try {
        const res  = await fetch(`/api/v1/admin/shop/products/${id}`, { credentials: 'include' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to load product');
        product = data.product;
        this._detailCache.set(id, product);
      } catch (err) {
        panel.innerHTML = `<p class="admin-shop__error">${_esc(err.message)}</p>`;
        return;
      }
    }
    panel.innerHTML = this._detailPanelHtml(product);
    panel.querySelector('[data-action="edit"]')?.addEventListener('click', () => this._showForm(product));
    panel.querySelector('[data-action="history"]')?.addEventListener('click', () => this._loadHistory(product, panel));
  }

  // The stock audit trail (GET /products/:id/adjustments): who moved how much,
  // why, and for which order. Every stock change lands there.
  async _loadHistory(product, panel) {
    const host = panel.querySelector('[data-history]');
    if (!host) return;
    host.innerHTML = `<p class="admin-shop__hint">${t('form.loading')}</p>`;
    try {
      const { adjustments } = await adminProductAdjustments(product.id);
      if (!adjustments.length) { host.innerHTML = `<p class="admin-shop__hint">${t('adminProducts.historyEmpty')}</p>`; return; }
      const reason = (r) => t(`adminProducts.reason.${r}`) === `adminProducts.reason.${r}` ? r : t(`adminProducts.reason.${r}`);
      host.innerHTML = `
        <table class="prod-detail__variants prod-history__table">
          <thead><tr>
            <th>${t('adminProducts.historyWhen')}</th><th>SKU</th><th>${t('adminProducts.historyChange')}</th>
            <th>${t('adminProducts.historyReason')}</th><th>${t('adminProducts.historyWho')}</th>
          </tr></thead>
          <tbody>${adjustments.map(a => `<tr>
            <td>${_esc(new Date(a.created_at).toLocaleString(document.documentElement.lang || undefined))}</td>
            <td><code>${_esc(a.variant_sku || product.sku || '—')}</code></td>
            <td class="prod-history__delta${a.delta < 0 ? ' prod-history__delta--neg' : ''}">${a.delta > 0 ? '+' : ''}${a.delta} (${a.previous_stock} → ${a.new_stock})</td>
            <td>${_esc(reason(a.reason))}${a.order_number ? ` · ${_esc(a.order_number)}` : ''}${a.note ? ` · ${_esc(a.note)}` : ''}</td>
            <td>${_esc(a.user_name || '—')}</td>
          </tr>`).join('')}</tbody>
        </table>`;
    } catch (err) {
      host.innerHTML = `<p class="admin-shop__error">${_esc(err.message)}</p>`;
    }
  }

  _detailPanelHtml(p) {
    const variants = Array.isArray(p.variants) ? p.variants : [];
    const onHand    = Number(p.on_hand ?? p.stock) || 0;
    const committed = Number(p.committed) || 0;
    const available = p.available == null ? onHand - committed : Number(p.available);
    const fmtDate = (iso) => iso
      ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
      : '—';
    const field = (label, val) => `<div class="prod-detail__field"><dt>${label}</dt><dd>${val}</dd></div>`;
    const axes = Array.isArray(p.variant_axes) ? p.variant_axes : [];
    const variantTable = variants.length ? `
      <table class="prod-detail__variants">
        <thead><tr>
          ${axes.map(a => `<th>${_esc(a.charAt(0).toUpperCase() + a.slice(1))}</th>`).join('')}
          <th>SKU</th><th>${t('adminProducts.detailBin')}</th><th>${t('adminProducts.available')}</th><th>${t('adminProducts.onHand')}</th><th>${t('adminProducts.priceISK')}</th>
        </tr></thead>
        <tbody>
          ${variants.map(v => `<tr>
            ${axes.map(a => `<td>${_esc(v.attributes?.[a] ?? '—')}</td>`).join('')}
            <td><code>${_esc(v.sku || '—')}</code></td>
            <td>${_esc(v.bin || '—')}</td>
            <td>${v.available ?? (Number(v.stock) || 0)}</td>
            <td>${Number(v.stock) || 0}</td>
            <td>${cart.formatMoney(v.price_isk ?? p.price_isk, 'ISK')}</td>
          </tr>`).join('')}
        </tbody>
      </table>` : '';
    return `
      <dl class="prod-detail__grid">
        ${field(t('adminProducts.detailPrice'), `${cart.formatMoney(p.price_isk, 'ISK')} · ${cart.formatMoney(p.price_eur, 'EUR')}`)}
        ${field(t('adminProducts.available'), String(available))}
        ${field(t('adminProducts.onHand'), String(onHand))}
        ${field(t('adminProducts.committed'), String(committed))}
        ${field(t('adminProducts.detailSku'), _esc(p.sku || '—'))}
        ${field(t('adminProducts.detailBin'), _esc(p.bin || '—'))}
        ${field(t('adminProducts.detailBarcode'), _esc(p.barcode || '—'))}
        ${field(t('adminProducts.detailType'), _esc(p.category || '—'))}
        ${field(t('adminProducts.active'), p.active ? '✓' : '—')}
        ${field(t('adminProducts.detailUpdated'), fmtDate(p.updated_at))}
      </dl>
      ${variantTable}
      <div class="prod-history" data-history></div>
      <div class="prod-detail__actions">
        <button type="button" class="admin-shop__link" data-action="history">${t('adminProducts.stockHistory')}</button>
        <a class="admin-shop__link" href="${_esc(href('/shop/' + p.slug))}" data-route="/shop/${_esc(p.slug)}">${t('adminProducts.viewInStore')}</a>
        <button type="button" class="admin-shop__link" data-action="edit">${t('admin.edit')}</button>
      </div>
    `;
  }

  _showForm(existing = null) {
    openProductFormModal({
      existing,
      onSaved: () => this._load(),
      paintImages:   (modal, product) => this._paintImages(modal, product),
      paintVariants: (modal, product) => this._paintVariants(modal, product),
    });
  }


  _paintImages(modal, product) {
    const list = modal.querySelector('#admin-product-images');
    if (!list) return;
    if (!product.images || product.images.length === 0) {
      list.innerHTML = `<p class="admin-shop__hint">${t('adminProducts.noImages')}</p>`;
      return;
    }
    list.innerHTML = product.images.map(img => `
      <div class="admin-shop__image-item" data-img-id="${_esc(img.id)}">
        <img src="${_esc(thumbUrl(img.url))}" alt="" loading="lazy"/>
        <button type="button" class="admin-shop__image-del" data-img-id="${_esc(img.id)}">${t('admin.delete')}</button>
      </div>
    `).join('');
    list.querySelectorAll('.admin-shop__image-del').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm(t('adminProducts.confirmDeleteImage'))) return;
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
        ${t('adminProducts.noVariants')}
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
      status.textContent = t('form.saving');
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
        status.textContent = t('form.saved');
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

  // ── CSV export / import ───────────────────────────────────────────────────────
  _exportCsv() {
    const a = document.createElement('a');
    a.href = adminExportProductsUrl();
    a.download = '';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  _openImportModal() {
    const modal = document.createElement('div');
    modal.className = 'admin-shop__modal';
    modal.innerHTML = `
      <div class="admin-shop__modal-card">
        <header>
          <h2>${t('adminProducts.importTitle')}</h2>
          <button type="button" class="admin-shop__modal-close" aria-label="${t('common.close')}">✕</button>
        </header>
        <div class="prod-import">
          <p class="admin-shop__hint">${t('adminProducts.importIntro')}</p>
          <label class="admin-shop__upload-btn">
            <input type="file" accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.pdf,application/pdf" id="prod-import-file"/>
            ${t('adminProducts.importChooseFile')}
          </label>
          <label class="prod-import__create">
            <input type="checkbox" id="prod-import-create"/>
            ${t('adminProducts.importCreate')}
          </label>
          <p class="admin-shop__error" id="prod-import-error" role="alert"></p>
          <div id="prod-import-preview"></div>
        </div>
      </div>`;
    document.body.appendChild(modal);
    const close = () => modal.remove();
    modal.querySelector('.admin-shop__modal-close').addEventListener('click', close);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

    const errorEl   = modal.querySelector('#prod-import-error');
    const previewEl = modal.querySelector('#prod-import-preview');

    // Every file is read on the SERVER (POST /products/import/parse-file —
    // services/productImport, harvested from icelandicstore): the CSV this page
    // exports, a supplier .xlsx, a generated PDF order or price list. The rows
    // come back and go through the same preview → apply as before.
    let parsed = null;
    const createBox = modal.querySelector('#prod-import-create');
    const preview = async () => {
      if (!parsed) return;
      errorEl.textContent = '';
      previewEl.innerHTML = `<p class="admin-shop__hint">${t('adminProducts.importPreviewing')}</p>`;
      try {
        const result = await adminPreviewProductImport(parsed.rows, { create: createBox.checked });
        this._renderImportPreview(previewEl, result, parsed, createBox.checked, close);
      } catch (err) {
        previewEl.innerHTML = '';
        errorEl.textContent = err.message;
      }
    };
    createBox.addEventListener('change', preview);
    modal.querySelector('#prod-import-file').addEventListener('change', async (e) => {
      errorEl.textContent = '';
      previewEl.innerHTML = '';
      parsed = null;
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      previewEl.innerHTML = `<p class="admin-shop__hint">${t('adminProducts.importReading')}</p>`;
      try {
        parsed = await adminParseProductImportFile(file);
      } catch (err) {
        previewEl.innerHTML = '';
        errorEl.textContent = err.message;
        return;
      }
      await preview();
    });
  }

  _renderImportPreview(previewEl, result, parsed, create, close) {
    const { counts, rows, createProducts } = result;
    const label = (k) => `${counts[k] || 0} ${t('adminProducts.importStatus' + k.charAt(0).toUpperCase() + k.slice(1))}`;
    const canApply = (counts.update || 0) > 0 || (counts.create || 0) > 0;
    const kinds = ['update', 'nochange', 'unmatched', 'error'].concat(create ? ['create'] : []);
    const reason = (r) => {
      const key = `adminProducts.importReason.${r.reason}`;
      const text = t(key);
      return text === key ? r.reason : text;
    };
    const errors = rows.filter(r => r.status === 'error').slice(0, 20);
    const skipped = (parsed.orderQtyColumns || []).length
      ? `<p class="admin-shop__hint">${_esc(t('adminProducts.importOrderQtySkipped', { cols: parsed.orderQtyColumns.join(', ') }))}</p>` : '';
    const ignored = (parsed.ignored || []).length
      ? `<p class="admin-shop__hint">${_esc(t('adminProducts.importIgnored', { cols: parsed.ignored.join(', ') }))}</p>` : '';
    const truncated = parsed.truncated ? `<p class="admin-shop__hint">${t('adminProducts.importTruncated')}</p>` : '';
    previewEl.innerHTML = `
      <p class="admin-shop__hint">${_esc(t('adminProducts.importRead', { n: parsed.rows.length, source: String(parsed.source || '').toUpperCase() }))}</p>
      ${skipped}${ignored}${truncated}
      <p class="prod-import__summary">${kinds.map(label).join(' · ')}</p>
      ${create && createProducts ? `<p class="admin-shop__hint">${_esc(t('adminProducts.importCreateProducts', { n: createProducts }))}</p>` : ''}
      ${errors.length ? `<ul class="prod-import__errors">${errors.map(r => `<li><code>${_esc(r.sku || '—')}</code> — ${_esc(reason(r))}${r.errorField ? ` (${_esc(r.errorField)})` : ''}</li>`).join('')}</ul>` : ''}
      <div class="admin-shop__form-actions">
        <button type="button" class="admin-shop__primary-btn" id="prod-import-apply" ${canApply ? '' : 'disabled'}>${t('adminProducts.importApply')}</button>
      </div>
      <p class="admin-shop__hint" id="prod-import-status" aria-live="polite"></p>`;
    const statusEl = previewEl.querySelector('#prod-import-status');
    previewEl.querySelector('#prod-import-apply')?.addEventListener('click', async () => {
      const btn = previewEl.querySelector('#prod-import-apply');
      btn.disabled = true;
      statusEl.textContent = t('adminProducts.importApplying');
      try {
        const res = await adminApplyProductImport(parsed.rows, { create });
        statusEl.textContent = t('adminProducts.importDone', { n: res.updated })
          + (res.created ? ' ' + t('adminProducts.importCreated', { n: res.created, v: res.createdVariants }) : '');
        this._detailCache.clear(); // detail panels are stale after bulk edits
        await this._load();
        setTimeout(close, 1500);
      } catch (err) {
        statusEl.textContent = err.message;
        btn.disabled = false;
      }
    });
  }

  destroy() {}
}

// ── Standalone modal (reused by ShopView "Add Product" button) ──────────────
//
// openProductFormModal({ existing, onSaved, paintImages, paintVariants })
//   existing       — product row for edit mode, null for new-product mode
//   onSaved        — called after a successful create/update/deactivate
//   paintImages    — optional renderer for the images section (admin edit only)
//   paintVariants  — optional renderer for the variants section (admin edit only)
//
// The images/variants sub-sections are only rendered when `existing` is set
// (a product must be saved first to have an id for image/variant FKs), so a
// fresh-create flow (new product) doesn't need the paint callbacks.
export function openProductFormModal({ existing = null, onSaved = () => {}, paintImages, paintVariants } = {}) {
  const isEdit = !!existing;
  const modal = document.createElement('div');
  modal.className = 'admin-shop__modal';
  modal.innerHTML = `
    <div class="admin-shop__modal-card">
      <header>
        <h2>${isEdit ? t('adminProducts.editProduct') : t('adminProducts.createProduct')}</h2>
        <button type="button" class="admin-shop__modal-close" aria-label="${t('common.close')}">✕</button>
      </header>
      <form class="admin-shop__form" id="admin-product-form">
        <div class="admin-shop__form-row">
          <label>${t('adminProducts.categoryLabel')}
            <select name="category" id="admin-product-category" required>
              <option value="product"           ${(existing?.category || 'product') === 'product' ? 'selected' : ''}>${t('adminProducts.categoryProduct')}</option>
              <option value="tech_service"      ${existing?.category === 'tech_service' ? 'selected' : ''}>${t('adminProducts.categoryTech')}</option>
              <option value="carpentry_service" ${existing?.category === 'carpentry_service' ? 'selected' : ''}>${t('adminProducts.categoryCarpentry')}</option>
            </select>
          </label>
          <label>${t('adminProducts.subcategoryLabel')}
            <input type="text" name="subcategory" maxlength="60"
                   value="${_esc(existing?.subcategory || '')}"
                   placeholder="${t('adminProducts.subcategoryPlaceholder')}"/>
          </label>
        </div>
        <label>${t('adminProducts.name')}
          <input type="text" name="name" required maxlength="200" value="${_esc(existing?.name || '')}"/>
        </label>
        <label>${t('adminProducts.slugLabel')}
          <input type="text" name="slug" required pattern="[a-z0-9](?:[a-z0-9-]{0,80}[a-z0-9])?"
                 value="${_esc(existing?.slug || '')}"/>
        </label>
        <label>${t('adminProducts.description')}
          <textarea name="description" rows="4">${_esc(existing?.description || '')}</textarea>
        </label>
        <div class="admin-shop__form-row">
          <label>${t('adminProducts.priceISKLabel')}
            <input type="number" name="price_isk" required min="1" step="1" value="${existing?.price_isk ?? ''}"/>
          </label>
          <label>${t('adminProducts.priceEURLabel')}
            <input type="number" name="price_eur" required min="1" step="1" value="${existing?.price_eur ?? ''}"/>
          </label>
          <label>${t('adminProducts.vatRateLabel')}
            <select name="vat_rate">
              ${[24, 11, 0].map(r => `<option value="${r}"${(existing?.vat_rate ?? 24) === r ? ' selected' : ''}>${t(`adminProducts.vatRate${r}`)}</option>`).join('')}
            </select>
          </label>
        </div>
        <div class="admin-shop__form-row">
          <label>${t('adminProducts.stock')}
            <input type="number" name="stock" min="0" step="1" value="${existing?.stock ?? 0}"/>
          </label>
          ${isEdit ? `<label>${t('adminProducts.stockReason')}
            <select name="stock_reason">
              ${STOCK_REASONS.map(rs => `<option value="${rs}">${t(`adminProducts.reason.${rs}`)}</option>`).join('')}
            </select>
          </label>
          <label>${t('adminProducts.stockNote')}
            <input type="text" name="stock_note" maxlength="500"/>
          </label>` : ''}
          <label>${t('adminProducts.weight')}
            <input type="number" name="weight_grams" min="0" step="1" value="${existing?.weight_grams ?? ''}"/>
          </label>
          <label class="admin-shop__checkbox">
            <input type="checkbox" name="active" ${existing?.active === false ? '' : 'checked'}/>
            ${t('adminProducts.active')}
          </label>
        </div>
        <div class="admin-shop__form-row">
          <label>${t('adminProducts.sku')}
            <input type="text" name="sku" maxlength="100" value="${_esc(existing?.sku || '')}"/>
          </label>
          <label>${t('adminProducts.barcode')}
            <input type="text" name="barcode" id="admin-product-barcode" maxlength="64" value="${_esc(existing?.barcode || '')}"/>
          </label>
          ${BarcodeScanner.isSupported() ? `<button type="button" class="admin-shop__link" id="admin-scan-barcode">${t('shop.scan.button')}</button>` : ''}
        </div>
        <p class="admin-shop__hint">${t('adminProducts.priceHintShort')}</p>

        <!-- Service-only fields. Hidden when category === 'product'; shown
             for tech_service / carpentry_service. Wired up below. -->
        <fieldset id="admin-product-service-fields"
                  style="display:${(existing?.category && existing.category !== 'product') ? 'block' : 'none'}">
          <legend>${t('adminProducts.serviceFieldsLegend')}</legend>
          <div class="admin-shop__form-row">
            <label>${t('adminProducts.durationMinutesLabel')}
              <input type="number" name="duration_minutes" min="1" step="1"
                     value="${existing?.duration_minutes ?? ''}"/>
            </label>
            <label>${t('adminProducts.deliveryFormatLabel')}
              <select name="delivery_format">
                <option value=""          ${!existing?.delivery_format ? 'selected' : ''}>—</option>
                <option value="remote"    ${existing?.delivery_format === 'remote'    ? 'selected' : ''}>${t('adminProducts.deliveryRemote')}</option>
                <option value="in_person" ${existing?.delivery_format === 'in_person' ? 'selected' : ''}>${t('adminProducts.deliveryInPerson')}</option>
                <option value="hybrid"    ${existing?.delivery_format === 'hybrid'    ? 'selected' : ''}>${t('adminProducts.deliveryHybrid')}</option>
              </select>
            </label>
            <label class="admin-shop__checkbox">
              <input type="checkbox" name="is_bookable" ${existing?.is_bookable ? 'checked' : ''}/>
              ${t('adminProducts.isBookableLabel')}
            </label>
          </div>
        </fieldset>

        <!-- Icelandic translations — nullable siblings. Left blank ⇒ IS
             visitors see the English fallback. See migration 031. -->
        <fieldset class="admin-product-form__translations">
          <legend class="admin-product-form__translations-legend">${t('admin.translations')} — ${t('admin.icelandicField')}</legend>
          <p class="admin-product-form__translations-hint">${t('admin.translationsHint')}</p>
          <label>Heiti (íslenska)
            <input type="text" name="name_is" maxlength="200" value="${_esc(existing?.name_is || '')}"/>
          </label>
          <label>Lýsing (íslenska)
            <textarea name="description_is" rows="4">${_esc(existing?.description_is || '')}</textarea>
          </label>
        </fieldset>

        <!-- Auto-translate opt-in for the save. Server translates empty
             name_is / description_is from their EN counterparts. -->
        <label class="admin-product-form__check">
          <input type="checkbox" name="__autoTranslate" checked/>
          ${t('admin.autoTranslate')}
        </label>

        <p class="admin-shop__error" id="admin-product-error" role="alert"></p>
        <div class="admin-shop__form-actions">
          ${isEdit ? `<button type="button" class="admin-shop__delete" id="admin-product-deactivate">${t('adminProducts.deactivate')}</button>` : ''}
          <button type="submit" class="admin-shop__primary-btn">${isEdit ? t('form.save') : t('form.create')}</button>
        </div>
      </form>

      ${isEdit ? `
        <section class="admin-shop__images">
          <h3>${t('adminProducts.images')}</h3>
          <div class="admin-shop__image-list" id="admin-product-images"></div>
          <label class="admin-shop__upload-btn">
            <input type="file" accept="image/jpeg,image/png,image/webp" id="admin-product-image-input" multiple/>
            ${t('adminProducts.uploadImage')}
          </label>
        </section>

        <section class="admin-shop__variants">
          <h3>${t('adminProducts.variants')} <span class="admin-shop__hint" style="margin:0 8px;font-size:12px">
            ${(existing.variants || []).length} SKUs</span></h3>
          <p class="admin-shop__hint">${t('adminProducts.variantHint')}</p>
          <div id="admin-variant-table-wrap"></div>
        </section>

        <section class="admin-shop__collections">
          <h3>${t('adminProducts.collections')}</h3>
          <div class="admin-shop__coll-list" id="admin-product-collections"></div>
          <div class="admin-shop__coll-new">
            <input type="text" id="admin-new-collection" placeholder="${t('adminProducts.newCollectionPlaceholder')}" maxlength="200"/>
            <button type="button" class="admin-shop__link" id="admin-add-collection">${t('adminProducts.addCollection')}</button>
          </div>
        </section>` : ''}
    </div>
  `;
  document.body.appendChild(modal);

  const close = () => modal.remove();
  modal.querySelector('.admin-shop__modal-close').addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

  // Optional camera barcode scan → fills the barcode field (button only present
  // when the native BarcodeDetector API is available; see BarcodeScanner).
  const scanBtn = modal.querySelector('#admin-scan-barcode');
  if (scanBtn) {
    scanBtn.addEventListener('click', () => {
      const scanner = new BarcodeScanner({
        onDetect: (code) => {
          const inp = modal.querySelector('#admin-product-barcode');
          if (inp) inp.value = code;
          scanner.close();
        },
      });
      scanner.open();
    });
  }

  const form    = modal.querySelector('#admin-product-form');
  const errorEl = modal.querySelector('#admin-product-error');

  // Show service-only fieldset only when category is a service-y one.
  const catSel = modal.querySelector('#admin-product-category');
  const svcBlk = modal.querySelector('#admin-product-service-fields');
  if (catSel && svcBlk) {
    catSel.addEventListener('change', () => {
      svcBlk.style.display = catSel.value === 'product' ? 'none' : 'block';
    });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.textContent = '';
    const fd = new FormData(form);
    // Icelandic siblings: empty ⇒ null ⇒ fall back to English (see Product model).
    const nameIs = String(fd.get('name_is')        || '').trim();
    const descIs = String(fd.get('description_is') || '').trim();
    const body = {
      name:           String(fd.get('name') || '').trim(),
      slug:           String(fd.get('slug') || '').trim(),
      description:    String(fd.get('description') || ''),
      name_is:        nameIs || null,
      description_is: descIs || null,
      price_isk:      Number(fd.get('price_isk')),
      price_eur:      Number(fd.get('price_eur')),
      // VSK rate charged on this product. 11% is a closed statutory list (books,
      // printed matter, food...) — see server/utils/vat.js.
      vat_rate:       Number(fd.get('vat_rate') ?? 24),
      stock:          Number(fd.get('stock') || 0),
      // A stock change is audited (server models/Inventory.js): the reason and
      // note ride along only when the figure actually changed.
      ...(isEdit && Number(fd.get('stock') || 0) !== Number(existing.stock)
        ? { stock_reason: String(fd.get('stock_reason') || 'correction'),
            stock_note: String(fd.get('stock_note') || '').trim() || null }
        : {}),
      active:         fd.get('active') === 'on',
      // Shop redesign step 1 — language-neutral taxonomy + service fields.
      category:         String(fd.get('category') || 'product'),
      subcategory:      String(fd.get('subcategory') || '').trim() || null,
      duration_minutes: fd.get('duration_minutes') ? Number(fd.get('duration_minutes')) : null,
      delivery_format:  String(fd.get('delivery_format') || '') || null,
      is_bookable:      fd.get('is_bookable') === 'on',
      // Server-side EN → IS auto-translation of empty IS fields on save.
      __autoTranslate: fd.get('__autoTranslate') !== null,
    };
    const wg = fd.get('weight_grams');
    if (wg !== null && wg !== '') body.weight_grams = Number(wg);
    // Inventory codes — empty ⇒ null (clears the column; keeps the sku index sparse).
    body.sku     = String(fd.get('sku') || '').trim() || null;
    body.barcode = String(fd.get('barcode') || '').trim() || null;
    // Collection membership (edit mode only) — checked ids replace the set.
    if (isEdit) {
      body.collection_ids = [...modal.querySelectorAll('#admin-product-collections input[data-coll-id]')]
        .filter(c => c.checked).map(c => c.dataset.collId);
    }

    try {
      const headers = await getCsrfHeaders();
      const url    = isEdit ? `/api/v1/admin/shop/products/${existing.id}` : '/api/v1/admin/shop/products';
      const method = isEdit ? 'PATCH' : 'POST';
      const res    = await fetch(url, { method, credentials: 'include', headers, body: JSON.stringify(body) });
      const data   = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed');
      close();
      await onSaved(data.product || null);
    } catch (err) {
      errorEl.textContent = err.message;
    }
  });

  if (isEdit) {
    modal.querySelector('#admin-product-deactivate')?.addEventListener('click', async () => {
      if (!confirm(t('adminProducts.confirmDeactivate'))) return;
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
        await onSaved(null);
      } catch (err) {
        errorEl.textContent = err.message;
      }
    });

    if (paintVariants) paintVariants(modal, existing);
    if (paintImages)   paintImages(modal, existing);

    // Collections — checkboxes of all collections (checked = member), plus an
    // inline "new collection" creator. Membership is sent as collection_ids on
    // the product PATCH (see the submit handler above).
    (async () => {
      const wrap = modal.querySelector('#admin-product-collections');
      if (!wrap) return;
      let all = [];
      try {
        const res  = await fetch('/api/v1/admin/shop/collections', { credentials: 'include' });
        const data = await res.json();
        all = data.collections || [];
      } catch { /* offline — section just shows empty */ }
      const memberIds = new Set((existing.collections || []).map(c => c.id));
      const render = () => {
        wrap.innerHTML = all.length
          ? all.map(c => `<label class="admin-shop__coll-item">
              <input type="checkbox" data-coll-id="${_esc(c.id)}" ${memberIds.has(c.id) ? 'checked' : ''}/>
              ${_esc(c.title)}${c.active ? '' : ' — ' + t('adminProducts.inactive')}
            </label>`).join('')
          : `<p class="admin-shop__hint">${t('adminProducts.noCollections')}</p>`;
        wrap.querySelectorAll('input[data-coll-id]').forEach(box => {
          box.addEventListener('change', () => {
            if (box.checked) memberIds.add(box.dataset.collId);
            else memberIds.delete(box.dataset.collId);
          });
        });
      };
      render();
      modal.querySelector('#admin-add-collection')?.addEventListener('click', async () => {
        const inp   = modal.querySelector('#admin-new-collection');
        const title = (inp.value || '').trim();
        if (!title) return;
        const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
        try {
          const headers = await getCsrfHeaders();
          const res  = await fetch('/api/v1/admin/shop/collections', {
            method: 'POST', credentials: 'include', headers, body: JSON.stringify({ slug, title }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Failed to create collection');
          all.push(data.collection);
          memberIds.add(data.collection.id);
          inp.value = '';
          render();
        } catch (err) {
          errorEl.textContent = err.message;
        }
      });
    })();

    // Upload from the file picker, or from files dropped onto the Images section
    // (drag-and-drop, harvested from icelandicstore #240). Non-image files in a
    // drop are skipped and counted.
    const uploadFiles = async (picked) => {
      const files = picked.filter(f => /^image\/(jpeg|png|webp)$/.test(f.type));
      const skipped = picked.length - files.length;
      if (!files.length) {
        if (skipped) errorEl.textContent = t('adminProducts.dropSkipped', { n: skipped });
        return;
      }

      const token  = await getCSRFToken();
      const total  = files.length;
      let done     = 0;
      let failed   = 0;

      for (const file of files) {
        done++;
        errorEl.textContent = t('adminProducts.uploadingProgress', { n: done, total, name: file.name });
        try {
          const fdata = new FormData();
          fdata.append('file', file);
          const res = await fetch(`/api/v1/admin/shop/products/${existing.id}/images`, {
            method: 'POST', credentials: 'include',
            headers: { 'X-CSRF-Token': token || '' }, body: fdata,
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Upload failed');
          existing.images = [...(existing.images || []), data.image];
          if (paintImages) paintImages(modal, existing);
        } catch (err) {
          failed++;
          console.error(`Upload failed for ${file.name}:`, err);
        }
      }

      try {
        const refreshed = await (await fetch(`/api/v1/admin/shop/products/${existing.id}`, { credentials: 'include' })).json();
        existing.images = refreshed.product.images;
        if (paintImages) paintImages(modal, existing);
        await onSaved(refreshed.product);
      } catch (err) {
        console.error('Refresh after upload failed:', err);
      }

      errorEl.textContent = (failed === 0
        ? t('adminProducts.uploadedAll', { n: total })
        : t('adminProducts.uploadedPartial', { ok: total - failed, total, failed }))
        + (skipped ? ' ' + t('adminProducts.dropSkipped', { n: skipped }) : '');
    };

    modal.querySelector('#admin-product-image-input')?.addEventListener('change', (e) => {
      const files = Array.from(e.target.files || []);
      e.target.value = '';
      if (files.length) uploadFiles(files);
    });

    const zone = modal.querySelector('.admin-shop__images');
    if (zone) {
      zone.classList.add('admin-shop__dropzone');
      const hasFiles = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');
      const swallow = (e) => { e.preventDefault(); e.stopPropagation(); };
      zone.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; swallow(e); zone.classList.add('is-dragover'); });
      zone.addEventListener('dragover', (e) => {
        if (!hasFiles(e)) return;
        swallow(e);
        e.dataTransfer.dropEffect = 'copy';
        zone.classList.add('is-dragover');
      });
      zone.addEventListener('dragleave', (e) => {
        // dragleave fires between the section's children too — only clear the
        // highlight once the pointer has actually left it.
        if (e.relatedTarget && zone.contains(e.relatedTarget)) return;
        zone.classList.remove('is-dragover');
      });
      zone.addEventListener('drop', (e) => {
        if (!hasFiles(e)) return;
        swallow(e);
        zone.classList.remove('is-dragover');
        uploadFiles(Array.from(e.dataTransfer.files || []));
      });
      // A file dropped elsewhere on the open modal must not make the browser
      // navigate to it and lose the form.
      modal.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
      modal.addEventListener('drop', (e) => { if (hasFiles(e)) e.preventDefault(); });
    }
  }
}

// AdminOrdersView — admin order list with search, payment/fulfillment filter,
// independent status badges, and order tags. Each row opens the detail view
// (/admin/shop/orders/:id) where statuses + tags are edited. Route: /admin/shop/orders
import { fetchOrders, paymentBadge, fulfillmentBadge, bulkDeliveryNotesUrl } from '../services/adminOrders.js';
import * as cart from '../services/cart.js';
import { t, href } from '../i18n/i18n.js';
import { renderAdminShell } from '../components/AdminSidebar.js';
import { showToast } from '../components/Toast.js';
import { downloadCsv } from '../utils/downloadCsv.js';

function _esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function _formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

// Plain-text status label: looks up "<prefix><value>" and falls back to the raw
// value when no translation exists (t() returns the key on a miss).
function _statusLabel(prefix, v, fallback) {
  const val = String(v || fallback);
  const key = prefix + val;
  const label = t(key);
  return label === key ? val : label;
}

export class AdminOrdersView {
  constructor() { this._view = null; this._orders = []; this._filter = ''; this._q = ''; this._searchDebounce = null; this._selected = new Set(); }

  async render() {
    this._view = document.createElement('div');
    this._view.className = 'view admin-shop';
    this._view.innerHTML = `
      <div class="admin-shop__inner">
        <header class="admin-shop__header">
          <h1>${t('adminOrders.title')}</h1>
          <div class="admin-shop__header-controls">
            <input type="search" id="admin-orders-q" class="admin-shop__search"
                   placeholder="${t('adminOrders.searchPlaceholder')}" autocomplete="off"/>
            <select id="admin-orders-filter" class="admin-shop__select">
              <option value="">${t('adminOrders.all')}</option>
              <option value="pay:pending">${t('orderPayment.pending')}</option>
              <option value="pay:paid">${t('orderPayment.paid')}</option>
              <option value="ful:unfulfilled">${t('orderFulfillment.unfulfilled')}</option>
              <option value="ful:fulfilled">${t('orderFulfillment.fulfilled')}</option>
            </select>
            <button type="button" id="admin-orders-export" class="admin-shop__primary-btn">${t('adminProducts.export')}</button>
          </div>
        </header>
        <div id="admin-orders-body"><p>${t('form.loading')}</p></div>
      </div>
    `;
    this._view.querySelector('#admin-orders-filter').addEventListener('change', (e) => {
      this._filter = e.target.value;
      this._load();
    });
    const search = this._view.querySelector('#admin-orders-q');
    search.addEventListener('input', (e) => {
      clearTimeout(this._searchDebounce);
      const v = e.target.value;
      this._searchDebounce = setTimeout(() => { this._q = v; this._load(); }, 250);
    });
    this._view.querySelector('#admin-orders-export').addEventListener('click', () => this._exportCsv());
    await this._load();
    return renderAdminShell({ activePath: '/admin/shop/orders', content: this._view });
  }

  _filterParams() {
    const p = {};
    if (this._q) p.q = this._q;
    if (this._filter.startsWith('pay:')) p.paymentStatus = this._filter.slice(4);
    else if (this._filter.startsWith('ful:')) p.fulfillmentStatus = this._filter.slice(4);
    return p;
  }

  async _load() {
    try {
      this._selected.clear(); // selection is per-result-set; reset on each (re)load
      const data = await fetchOrders(this._filterParams());
      this._orders = data.orders || [];
      this._paint();
    } catch (err) {
      this._view.querySelector('#admin-orders-body').innerHTML =
        `<p class="admin-shop__error">${_esc(err.message)}</p>`;
    }
  }

  _paint() {
    const body = this._view.querySelector('#admin-orders-body');
    if (this._orders.length === 0) {
      body.innerHTML = `<p>${t('adminOrders.noOrders')}.</p>`;
      return;
    }
    body.innerHTML = `
      <div class="admin-orders__bulkbar" id="admin-orders-bulkbar" hidden>
        <span id="admin-orders-bulkcount"></span>
        <button type="button" class="admin-shop__primary-btn" id="admin-orders-print">${t('adminOrders.print')}</button>
        <button type="button" class="admin-shop__link" id="admin-orders-clear">${t('adminOrders.clearSelection')}</button>
      </div>
      <table class="admin-shop__table">
        <thead><tr>
          <th class="admin-orders__check"><input type="checkbox" id="admin-orders-all" aria-label="${t('adminOrders.selectAll')}"/></th>
          <th>${t('orders.order')}</th><th>${t('orders.date')}</th><th>${t('adminOrders.customer')}</th>
          <th>${t('adminOrders.payment')}</th><th>${t('adminOrders.fulfillment')}</th>
          <th>${t('adminOrders.tags')}</th><th>${t('orders.total')}</th>
        </tr></thead>
        <tbody>
          ${this._orders.map(o => `
            <tr data-id="${_esc(o.id)}">
              <td class="admin-orders__check"><input type="checkbox" class="admin-orders__row-check" data-id="${_esc(o.id)}" ${this._selected.has(String(o.id)) ? 'checked' : ''}/></td>
              <td><a class="admin-shop__link" href="${href('/admin/shop/orders/' + o.id)}" data-route="/admin/shop/orders/${_esc(o.id)}"><code>${_esc(o.order_number)}</code></a></td>
              <td>${_formatDate(o.created_at)}</td>
              <td>${_esc(o.user_email || o.guest_email || o.guest_name || '—')}</td>
              <td>${paymentBadge(t, o.payment_status)}</td>
              <td>${fulfillmentBadge(t, o.fulfillment_status)}</td>
              <td>${(Array.isArray(o.tags) ? o.tags : []).map(tag => `<span class="ord-tag ord-tag--ro">${_esc(tag)}</span>`).join('') || '—'}</td>
              <td>${cart.formatMoney(o.total, o.currency)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    `;
    body.querySelectorAll('.admin-orders__row-check').forEach(cb => {
      cb.addEventListener('change', () => {
        if (cb.checked) this._selected.add(cb.dataset.id); else this._selected.delete(cb.dataset.id);
        this._syncBulkBar();
      });
    });
    body.querySelector('#admin-orders-all')?.addEventListener('change', (e) => {
      const on = e.target.checked;
      body.querySelectorAll('.admin-orders__row-check').forEach(cb => {
        cb.checked = on;
        if (on) this._selected.add(cb.dataset.id); else this._selected.delete(cb.dataset.id);
      });
      this._syncBulkBar();
    });
    body.querySelector('#admin-orders-print')?.addEventListener('click', () => {
      const ids = [...this._selected];
      if (ids.length) window.open(bulkDeliveryNotesUrl(ids), '_blank', 'noopener');
    });
    body.querySelector('#admin-orders-clear')?.addEventListener('click', () => {
      this._selected.clear();
      body.querySelectorAll('.admin-orders__row-check, #admin-orders-all').forEach(cb => { cb.checked = false; });
      this._syncBulkBar();
    });
    this._syncBulkBar();
  }

  _syncBulkBar() {
    const bar   = this._view.querySelector('#admin-orders-bulkbar');
    const count = this._view.querySelector('#admin-orders-bulkcount');
    const n = this._selected.size;
    if (bar)   bar.hidden = n === 0;
    if (count) count.textContent = t('adminOrders.bulkSelected', { n });
  }

  // ── CSV export ──────────────────────────────────────────────────────────────
  // Exports the orders currently loaded for the active search + filter. The
  // /orders endpoint caps the list at 200 rows, so very large result sets are
  // truncated to that ceiling (the search/filter narrows it in practice).
  _exportCsv() {
    const btn = this._view.querySelector('#admin-orders-export');
    if (btn) btn.disabled = true;
    try {
      const header = [
        t('orders.order'), t('orders.date'), t('adminOrders.customer'), t('orders.total'),
        t('adminOrders.payment'), t('adminOrders.fulfillment'), t('adminOrders.items'), t('adminOrders.tags'),
      ];
      const rows = this._orders.map(o => [
        o.order_number,
        _formatDate(o.created_at),
        o.user_email || o.guest_email || o.guest_name || '',
        Number(o.total) || 0,
        _statusLabel('orderPayment.', o.payment_status, 'pending'),
        _statusLabel('orderFulfillment.', o.fulfillment_status, 'unfulfilled'),
        Number(o.item_count) || 0,
        Array.isArray(o.tags) ? o.tags.join('; ') : '',
      ]);
      const today = new Date().toISOString().slice(0, 10);
      downloadCsv(`orders-${today}.csv`, header, rows);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  destroy() { clearTimeout(this._searchDebounce); }
}

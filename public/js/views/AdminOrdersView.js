// AdminOrdersView — admin order list with search, payment/fulfillment filter,
// independent status badges, and order tags. Each row opens the detail view
// (/admin/shop/orders/:id) where statuses + tags are edited. Route: /admin/shop/orders
import { fetchOrders, paymentBadge, fulfillmentBadge } from '../services/adminOrders.js';
import * as cart from '../services/cart.js';
import { t, href } from '../i18n/i18n.js';
import { renderAdminShell } from '../components/AdminSidebar.js';

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

export class AdminOrdersView {
  constructor() { this._view = null; this._orders = []; this._filter = ''; this._q = ''; this._searchDebounce = null; }

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
      <table class="admin-shop__table">
        <thead><tr>
          <th>${t('orders.order')}</th><th>${t('orders.date')}</th><th>${t('adminOrders.customer')}</th>
          <th>${t('adminOrders.payment')}</th><th>${t('adminOrders.fulfillment')}</th>
          <th>${t('adminOrders.tags')}</th><th>${t('orders.total')}</th>
        </tr></thead>
        <tbody>
          ${this._orders.map(o => `
            <tr data-id="${_esc(o.id)}">
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
  }

  destroy() { clearTimeout(this._searchDebounce); }
}

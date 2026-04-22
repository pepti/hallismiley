// AdminOrdersView — admin list & fulfillment view. Route: #/admin/shop/orders
import { getCSRFToken } from '../utils/api.js';
import * as cart from '../services/cart.js';
import { t } from '../i18n/i18n.js';

function _esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function _formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export class AdminOrdersView {
  constructor() { this._view = null; this._orders = []; this._filter = ''; }

  async render() {
    this._view = document.createElement('div');
    this._view.className = 'view admin-shop';
    this._view.innerHTML = `
      <div class="admin-shop__inner">
        <header class="admin-shop__header">
          <h1>${t('adminOrders.title')}</h1>
          <select id="admin-orders-filter" class="admin-shop__select">
            <option value="">${t('adminOrders.all')}</option>
            <option value="pending">${t('adminOrders.pending')}</option>
            <option value="paid">${t('adminOrders.paid')}</option>
            <option value="shipped">${t('adminOrders.shipped')}</option>
            <option value="failed">${t('adminOrders.failed')}</option>
            <option value="cancelled">${t('adminOrders.cancelled')}</option>
            <option value="refunded">${t('adminOrders.refunded')}</option>
          </select>
        </header>
        <div id="admin-orders-body"><p>${t('form.loading')}</p></div>
      </div>
    `;
    this._view.querySelector('#admin-orders-filter').addEventListener('change', (e) => {
      this._filter = e.target.value;
      this._load();
    });
    await this._load();
    return this._view;
  }

  async _load() {
    try {
      const url = this._filter
        ? `/api/v1/admin/shop/orders?status=${encodeURIComponent(this._filter)}`
        : '/api/v1/admin/shop/orders';
      const res = await fetch(url, { credentials: 'include' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load orders');
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
      body.innerHTML = `<p>${t('adminOrders.noOrders')}${this._filter ? ` — ${_esc(this._filter)}` : ''}.</p>`;
      return;
    }
    body.innerHTML = `
      <table class="admin-shop__table">
        <thead><tr>
          <th>${t('orders.order')}</th><th>${t('orders.date')}</th><th>${t('adminOrders.customer')}</th><th>${t('orders.status')}</th><th>${t('orders.total')}</th><th></th>
        </tr></thead>
        <tbody>
          ${this._orders.map(o => `
            <tr data-id="${_esc(o.id)}">
              <td><code>${_esc(o.order_number)}</code></td>
              <td>${_formatDate(o.created_at)}</td>
              <td>${_esc(o.guest_email || o.user_id || '—')}</td>
              <td><span class="admin-shop__status admin-shop__status--${_esc(o.status)}">${_esc(o.status)}</span></td>
              <td>${cart.formatMoney(o.total, o.currency)}</td>
              <td>
                ${o.status === 'paid' ? `<button type="button" class="admin-shop__link" data-action="ship" data-id="${_esc(o.id)}">${t('adminOrders.markShipped')}</button>` : ''}
                ${(o.status === 'pending' || o.status === 'paid') ? `<button type="button" class="admin-shop__link" data-action="cancel" data-id="${_esc(o.id)}">${t('admin.cancel')}</button>` : ''}
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    `;
    body.querySelectorAll('[data-action="ship"]').forEach(btn => {
      btn.addEventListener('click', () => this._updateStatus(btn.dataset.id, 'shipped'));
    });
    body.querySelectorAll('[data-action="cancel"]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (confirm(t('adminOrders.confirmCancel'))) this._updateStatus(btn.dataset.id, 'cancelled');
      });
    });
  }

  async _updateStatus(id, status) {
    try {
      const token = await getCSRFToken();
      const res = await fetch(`/api/v1/admin/shop/orders/${id}/status`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token || '' },
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Update failed');
      await this._load();
    } catch (err) {
      this._view.querySelector('#admin-orders-body').insertAdjacentHTML('afterbegin',
        `<p class="admin-shop__error">${_esc(err.message)}</p>`);
    }
  }

  destroy() {}
}

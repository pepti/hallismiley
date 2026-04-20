// OrderHistoryView — logged-in user's past orders. Route: #/orders
import * as cart from '../services/cart.js';

function _esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function _formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

export class OrderHistoryView {
  constructor() { this._view = null; }

  async render() {
    this._view = document.createElement('div');
    this._view.className = 'view shop-orders';
    this._view.innerHTML = `
      <div class="shop-orders__inner">
        <h1>Your orders</h1>
        <div id="shop-orders-body"><p>Loading…</p></div>
      </div>
    `;

    try {
      const res = await fetch('/api/v1/shop/orders/mine', { credentials: 'include' });
      if (res.status === 401) {
        this._view.querySelector('#shop-orders-body').innerHTML =
          `<p>Please <a href="#/login">sign in</a> to view your order history.</p>`;
        return this._view;
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load orders');
      this._paint(data.orders || []);
    } catch (err) {
      this._view.querySelector('#shop-orders-body').innerHTML =
        `<p class="shop-orders__error">${_esc(err.message)}</p>`;
    }
    return this._view;
  }

  _paint(orders) {
    const body = this._view.querySelector('#shop-orders-body');
    if (orders.length === 0) {
      body.innerHTML = `<p>You haven't placed any orders yet.</p>`;
      return;
    }
    body.innerHTML = `
      <table class="shop-orders__table">
        <thead>
          <tr><th>Order</th><th>Date</th><th>Status</th><th>Total</th></tr>
        </thead>
        <tbody>
          ${orders.map(o => `
            <tr>
              <td>${_esc(o.order_number)}</td>
              <td>${_formatDate(o.created_at)}</td>
              <td><span class="shop-orders__status shop-orders__status--${_esc(o.status)}">${_esc(o.status)}</span></td>
              <td>${cart.formatMoney(o.total, o.currency)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  destroy() {}
}

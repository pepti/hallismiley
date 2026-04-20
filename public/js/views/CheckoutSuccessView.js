// CheckoutSuccessView — lands here after Stripe Checkout success redirect.
// Route: #/checkout/success?session_id=...
// Polls /api/v1/shop/orders/by-session/:sid until paid (webhook may race).
import * as cart from '../services/cart.js';

function _esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function _qs(qs) {
  const params = new URLSearchParams(qs || '');
  return Object.fromEntries(params.entries());
}

export class CheckoutSuccessView {
  constructor(qs) {
    this._qs = _qs(qs);
    this._view = null;
    this._destroyed = false;
  }

  async render() {
    this._view = document.createElement('div');
    this._view.className = 'view shop-success';
    this._view.innerHTML = `
      <div class="shop-success__inner">
        <h1 class="shop-success__title">Thank you</h1>
        <p class="shop-success__sub" id="shop-success-status">
          Processing your payment…
        </p>
        <div id="shop-success-body"></div>
      </div>
    `;

    const sessionId = this._qs.session_id;
    if (!sessionId) {
      this._view.querySelector('#shop-success-status').textContent = 'Missing session id.';
      return this._view;
    }

    // Clear cart optimistically (payment succeeded in Stripe if we're here)
    cart.clear();

    this._poll(sessionId);
    return this._view;
  }

  async _poll(sessionId) {
    const maxAttempts = 12;         // ~20s with 1-2s backoff
    let delay = 800;
    for (let i = 0; i < maxAttempts; i++) {
      if (this._destroyed) return;
      try {
        const res = await fetch(
          `/api/v1/shop/orders/by-session/${encodeURIComponent(sessionId)}`,
          { credentials: 'include' }
        );
        if (res.ok) {
          const data = await res.json();
          const status = data.order?.status;
          if (status === 'paid') {
            this._renderPaid(data.order, data.items);
            return;
          }
          if (status === 'failed' || status === 'cancelled' || status === 'refunded') {
            this._renderFailed(data.order);
            return;
          }
        }
      } catch { /* keep polling */ }
      await new Promise(r => setTimeout(r, delay));
      delay = Math.min(2500, delay + 300);
    }
    // Timed out waiting — still ok, webhook will catch up later.
    const status = this._view.querySelector('#shop-success-status');
    status.textContent = 'Payment is being confirmed. You will receive an email shortly.';
  }

  _renderPaid(order, items) {
    const cur = order.currency;
    const fmt = (n) => cart.formatMoney(n, cur);
    const itemsHtml = (items || []).map(it => `
      <li class="shop-success__item">
        <span>${_esc(it.product_name_snapshot)} × ${it.quantity}</span>
        <span>${fmt(it.product_price_snapshot * it.quantity)}</span>
      </li>
    `).join('');
    // product_name_snapshot is already "Smiley T-shirt — Black / M" (shopController
    // calls buildLineName() when writing order_items), so no extra formatting.

    this._view.querySelector('#shop-success-status').textContent =
      'Payment confirmed — a receipt is on its way to your email.';
    this._view.querySelector('#shop-success-body').innerHTML = `
      <div class="shop-success__card">
        <p class="shop-success__order-number">
          Order <strong>${_esc(order.order_number)}</strong>
        </p>
        <ul class="shop-success__items">${itemsHtml}</ul>
        <div class="shop-success__total-row">
          <span>Subtotal</span><span>${fmt(order.subtotal)}</span>
        </div>
        <div class="shop-success__total-row">
          <span>Shipping</span><span>${fmt(order.shipping)}</span>
        </div>
        <div class="shop-success__grand">
          <span>Total</span><span>${fmt(order.total)}</span>
        </div>
        <p class="shop-success__vat-note">Price includes 24% VAT.</p>
        <a href="#/shop" class="shop-success__back">Keep shopping</a>
      </div>
    `;
  }

  _renderFailed(order) {
    this._view.querySelector('#shop-success-status').textContent =
      `Something went wrong with order ${order?.order_number || ''} — please contact us.`;
  }

  destroy() {
    this._destroyed = true;
  }
}

// CartView — review/edit the cart before checkout. Route: #/cart
import * as cart from '../services/cart.js';
import { CurrencySelector } from '../components/CurrencySelector.js';

function _esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export class CartView {
  constructor() {
    this._view = null;
    this._currencySelector = null;
    this._unsub = null;
  }

  async render() {
    this._view = document.createElement('div');
    this._view.className = 'view shop-cart';
    this._view.innerHTML = `
      <div class="shop-cart__inner">
        <header class="shop-cart__header">
          <h1>Your cart</h1>
          <div id="shop-cart-currency"></div>
        </header>
        <div id="shop-cart-body"></div>
      </div>
    `;

    this._currencySelector = new CurrencySelector({ onChange: () => this._paintBody() });
    this._view.querySelector('#shop-cart-currency').appendChild(this._currencySelector.render());

    this._paintBody();
    this._unsub = cart.subscribe(() => this._paintBody());
    return this._view;
  }

  _paintBody() {
    const body = this._view.querySelector('#shop-cart-body');
    const items = cart.list();
    const cur   = cart.getCurrency();

    if (items.length === 0) {
      body.innerHTML = `
        <p class="shop-cart__empty">Your cart is empty.</p>
        <a href="#/shop" class="shop-cart__continue">← Continue shopping</a>
      `;
      return;
    }

    const rowsHtml = items.map((it, idx) => {
      const price = cur === 'ISK' ? it.priceIsk : it.priceEur;
      const line  = price * it.qty;
      const key   = cart.lineKeyOf(it);
      return `
        <tr class="shop-cart__row" data-idx="${idx}">
          <td class="shop-cart__cell shop-cart__cell--product">
            ${it.imageUrl
              ? `<img class="shop-cart__thumb" src="${_esc(it.imageUrl)}" alt=""/>`
              : `<div class="shop-cart__thumb shop-cart__thumb--placeholder" aria-hidden="true"></div>`}
            <div>
              <a href="#/shop/${encodeURIComponent(it.slug)}" class="shop-cart__name">${_esc(it.name)}</a>
              ${it.variantLabel ? `<p class="shop-cart__variant">${_esc(it.variantLabel)}</p>` : ''}
              <p class="shop-cart__unit">${cart.formatMoney(price, cur)} each</p>
            </div>
          </td>
          <td class="shop-cart__cell">
            <input type="number" class="shop-cart__qty" min="0" value="${it.qty}"
                   data-key="${_esc(key)}" aria-label="Quantity for ${_esc(it.name)}"/>
          </td>
          <td class="shop-cart__cell shop-cart__cell--line">${cart.formatMoney(line, cur)}</td>
          <td class="shop-cart__cell">
            <button type="button" class="shop-cart__remove" data-key="${_esc(key)}"
                    aria-label="Remove ${_esc(it.name)}">✕</button>
          </td>
        </tr>`;
    }).join('');

    const subtotal = cart.total(cur);
    body.innerHTML = `
      <table class="shop-cart__table">
        <thead>
          <tr>
            <th>Item</th><th>Qty</th><th>Subtotal</th><th></th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>

      <div class="shop-cart__totals">
        <div class="shop-cart__total-row">
          <span>Subtotal</span>
          <span>${cart.formatMoney(subtotal, cur)}</span>
        </div>
        <p class="shop-cart__vat-note">Shipping calculated at checkout. Prices include 24% VAT.</p>
        <div class="shop-cart__actions">
          <a href="#/shop" class="shop-cart__continue">← Continue shopping</a>
          <a href="#/checkout" class="shop-cart__checkout" data-testid="cart-checkout">Proceed to checkout</a>
        </div>
      </div>
    `;

    body.querySelectorAll('.shop-cart__qty').forEach(input => {
      input.addEventListener('change', () => {
        cart.updateQty(input.dataset.key, Number(input.value));
      });
    });
    body.querySelectorAll('.shop-cart__remove').forEach(btn => {
      btn.addEventListener('click', () => {
        cart.remove(btn.dataset.key);
      });
    });
  }

  destroy() {
    if (this._currencySelector) this._currencySelector.destroy();
    if (this._unsub) this._unsub();
  }
}

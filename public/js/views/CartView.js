// CartView — review/edit the cart before checkout. Route: #/cart
import * as cart from '../services/cart.js';
import { indexAvailability, shortfallOf } from '../utils/availability.js';
import { vatBreakdown } from '../utils/vat.js';
import { translateVariantLabel } from '../utils/colorLabels.js';
import { CurrencySelector } from '../components/CurrencySelector.js';
import { t, href } from '../i18n/i18n.js';

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
          <h1>${t('cart.title')}</h1>
          <div id="shop-cart-currency"></div>
        </header>
        <div id="shop-cart-body"></div>
      </div>
    `;

    this._currencySelector = new CurrencySelector({ onChange: () => this._paintBody() });
    this._view.querySelector('#shop-cart-currency').appendChild(this._currencySelector.render());

    // Live availability for the stale-basket check (utils/availability.js): a
    // line added while stock was there may have sold out since. Best-effort —
    // the checkout and the webhook are the gates; this is the UX in front.
    this._avail = null;
    this._repriced = [];
    try {
      const res = await fetch('/api/v1/shop/products', { credentials: 'include' });
      if (res.ok) {
        const products = (await res.json()).products || [];
        this._avail = indexAvailability(products);
        // The same payload carries today's prices: a basket left open across a
        // price change shows what checkout will charge, and says so
        // (cart.syncPrices, ported from icelandicstore #343).
        this._repriced = cart.syncPrices(products);
      }
    } catch { /* no availability → no warnings */ }

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
        <p class="shop-cart__empty">${t('cart.empty')}</p>
        <a href="${href('/shop')}" class="shop-cart__continue">← ${t('cart.continueShopping')}</a>
      `;
      return;
    }

    let shortCount = 0;
    const rowsHtml = items.map((it, idx) => {
      const price = cur === 'ISK' ? it.priceIsk : it.priceEur;
      const line  = price * it.qty;
      const key   = cart.lineKeyOf(it);
      const short = this._avail ? shortfallOf(it, this._avail) : null;
      if (short) shortCount += 1;
      return `
        <tr class="shop-cart__row${short ? ' shop-cart__row--short' : ''}" data-idx="${idx}">
          <td class="shop-cart__cell shop-cart__cell--product">
            ${it.imageUrl
              ? `<img class="shop-cart__thumb" src="${_esc(it.imageUrl)}" alt=""/>`
              : `<div class="shop-cart__thumb shop-cart__thumb--placeholder" aria-hidden="true"></div>`}
            <div>
              <a href="${href('/shop/' + encodeURIComponent(it.slug))}" class="shop-cart__name">${_esc(it.name)}</a>
              ${it.variantLabel ? `<p class="shop-cart__variant">${_esc(translateVariantLabel(it.variantLabel, t))}</p>` : ''}
              ${short ? `<p class="shop-cart__short" data-testid="cart-short">${short.out ? t('cart.outOfStockLine') : t('cart.shortLine', { n: short.available })}</p>` : ''}
              <p class="shop-cart__unit">${cart.formatMoney(price, cur)} ${t('cart.each')}</p>
            </div>
          </td>
          <td class="shop-cart__cell">
            <input type="number" class="shop-cart__qty" min="0"${short && !short.out ? ` max="${short.available}"` : ''} value="${it.qty}"
                   data-key="${_esc(key)}" aria-label="${t('cart.qtyFor')} ${_esc(it.name)}"/>
          </td>
          <td class="shop-cart__cell shop-cart__cell--line">${cart.formatMoney(line, cur)}</td>
          <td class="shop-cart__cell">
            <button type="button" class="shop-cart__remove" data-key="${_esc(key)}"
                    aria-label="${t('cart.remove')} ${_esc(it.name)}">✕</button>
          </td>
        </tr>`;
    }).join('');

    const subtotal = cart.total(cur);
    body.innerHTML = `
      <table class="shop-cart__table">
        <thead>
          <tr>
            <th>${t('cart.item')}</th><th>${t('cart.qty')}</th><th>${t('cart.subtotal')}</th><th></th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>

      <div class="shop-cart__totals">
        <div class="shop-cart__total-row">
          <span>${t('cart.subtotal')}</span>
          <span>${cart.formatMoney(subtotal, cur)}</span>
        </div>
        <div class="shop-cart__vat">${vatBreakdown({ lines: cart.vatLines(cur) }).map(v => `
          <div class="shop-cart__vat-row" data-testid="cart-vat-${v.rate}">
            <span>${_esc(t('shop.vatIncludedRate', { rate: v.rate }))}</span>
            <span>${cart.formatMoney(v.vat, cur)}</span>
          </div>`).join('')}
        </div>
        ${this._repriced.length ? `<p class="shop-cart__notice" role="status" data-testid="cart-repriced">${_esc(t('cart.pricesUpdated', { names: this._repriced.map(it => it.variantLabel ? `${it.name} — ${translateVariantLabel(it.variantLabel, t)}` : it.name).join(', ') }))}</p>` : ''}
        ${shortCount ? `<p class="shop-cart__notice shop-cart__notice--warn" role="alert" data-testid="cart-stock-notice">${t('cart.stockNotice')}</p>` : ''}
        <div class="shop-cart__actions">
          <a href="${href('/shop')}" class="shop-cart__continue">← ${t('cart.continueShopping')}</a>
          ${shortCount
            ? `<button type="button" class="shop-cart__checkout" disabled data-testid="cart-checkout">${t('cart.checkoutBlocked')}</button>`
            : `<a href="${href('/checkout')}" class="shop-cart__checkout" data-testid="cart-checkout">${t('cart.checkout')}</a>`}
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

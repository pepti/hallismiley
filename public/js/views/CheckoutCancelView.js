import { t, href } from '../i18n/i18n.js';

export class CheckoutCancelView {
  constructor() { this._view = null; }

  async render() {
    this._view = document.createElement('div');
    this._view.className = 'view shop-cancel';
    this._view.innerHTML = `
      <div class="shop-cancel__inner">
        <h1>${t('checkout.cancelledTitle')}</h1>
        <p>${t('checkout.cancelledMessage')}</p>
        <div class="shop-cancel__actions">
          <a href="${href('/cart')}" class="shop-cancel__btn">${t('cart.title')}</a>
          <a href="${href('/shop')}" class="shop-cancel__link">${t('shop.continueShopping')}</a>
        </div>
      </div>
    `;
    return this._view;
  }

  destroy() {}
}

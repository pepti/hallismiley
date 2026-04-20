// CartIcon — nav badge that shows item count. Subscribes to cart pub/sub.
import * as cart from '../services/cart.js';

export class CartIcon {
  constructor() {
    this._unsub = null;
    this._el    = null;
  }

  render() {
    const a = document.createElement('a');
    a.href = '#/cart';
    a.className = 'lol-nav__cart';
    a.setAttribute('aria-label', 'Shopping cart');
    a.setAttribute('data-testid', 'nav-cart');
    a.innerHTML = `
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="9" cy="21" r="1"></circle>
        <circle cx="20" cy="21" r="1"></circle>
        <path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6"></path>
      </svg>
      <span class="lol-nav__cart-badge" data-testid="nav-cart-badge"></span>
    `;
    this._el = a;
    this._update();
    this._unsub = cart.subscribe(() => this._update());
    return a;
  }

  _update() {
    if (!this._el) return;
    const badge = this._el.querySelector('.lol-nav__cart-badge');
    if (!badge) return;
    const n = cart.itemCount();
    if (n > 0) {
      badge.textContent = String(n);
      badge.classList.add('has-items');
    } else {
      badge.textContent = '';
      badge.classList.remove('has-items');
    }
  }

  destroy() {
    if (this._unsub) this._unsub();
    this._unsub = null;
  }
}

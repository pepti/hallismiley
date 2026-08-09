// CurrencySelector — ISK/EUR toggle. Persists to localStorage via cart service.
import * as cart from '../services/cart.js';
import { t } from '../i18n/i18n.js';

export class CurrencySelector {
  constructor({ onChange } = {}) {
    this._onChange = onChange || (() => {});
    this._el = null;
    this._unsub = null;
  }

  render() {
    const wrap = document.createElement('div');
    wrap.className = 'shop-currency';
    wrap.setAttribute('role', 'group');
    wrap.setAttribute('aria-label', t('currency.label'));
    wrap.innerHTML = `
      <button type="button" class="shop-currency__btn" data-cur="ISK" data-testid="currency-isk">ISK</button>
      <button type="button" class="shop-currency__btn" data-cur="EUR" data-testid="currency-eur">EUR</button>
    `;
    wrap.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-cur]');
      if (!btn) return;
      cart.setCurrency(btn.dataset.cur);
      this._onChange(cart.getCurrency());
    });

    this._el = wrap;
    this._paint();
    this._unsub = cart.subscribe(() => this._paint());
    return wrap;
  }

  _paint() {
    if (!this._el) return;
    const cur = cart.getCurrency();
    for (const btn of this._el.querySelectorAll('[data-cur]')) {
      btn.classList.toggle('active', btn.dataset.cur === cur);
      btn.setAttribute('aria-pressed', btn.dataset.cur === cur ? 'true' : 'false');
    }
  }

  destroy() {
    if (this._unsub) this._unsub();
    this._unsub = null;
  }
}

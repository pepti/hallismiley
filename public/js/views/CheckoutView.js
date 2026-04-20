// CheckoutView — guest email + shipping form, then redirects to Stripe Checkout.
// Route: #/checkout
import * as cart from '../services/cart.js';
import { getUser } from '../services/auth.js';
import { getCsrfHeaders } from '../utils/api.js';

function _esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ISO-3166 alpha-2 country list (subset — Iceland + EU/EEA + a few others).
const COUNTRIES = [
  { code: 'IS', name: 'Iceland' },
  { code: 'DK', name: 'Denmark' },
  { code: 'NO', name: 'Norway' },
  { code: 'SE', name: 'Sweden' },
  { code: 'FI', name: 'Finland' },
  { code: 'DE', name: 'Germany' },
  { code: 'FR', name: 'France' },
  { code: 'NL', name: 'Netherlands' },
  { code: 'ES', name: 'Spain' },
  { code: 'IT', name: 'Italy' },
  { code: 'IE', name: 'Ireland' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'US', name: 'United States' },
];

export class CheckoutView {
  constructor() {
    this._view = null;
    this._shippingMethod = 'flat_rate';
    this._shippingRates = { flat_rate: { priceIsk: 2500, priceEur: 1900 }, local_pickup: { priceIsk: 0, priceEur: 0 } };
  }

  async render() {
    this._view = document.createElement('div');
    this._view.className = 'view shop-checkout';
    this._view.innerHTML = `<div class="shop-checkout__loading">Loading…</div>`;

    const items = cart.list();
    if (items.length === 0) {
      this._view.innerHTML = `
        <div class="shop-checkout__inner">
          <p class="shop-checkout__empty">Your cart is empty.</p>
          <a href="#/shop" class="shop-checkout__back">← Back to shop</a>
        </div>`;
      return this._view;
    }

    // Load shop config to get shipping rates
    try {
      const res = await fetch('/api/v1/shop/config');
      if (res.ok) {
        const cfg = await res.json();
        if (cfg.shipping) this._shippingRates = cfg.shipping;
      }
    } catch { /* keep defaults */ }

    this._paint();
    return this._view;
  }

  _paint() {
    const user = getUser();
    const items = cart.list();
    const cur   = cart.getCurrency();
    const subtotal = cart.total(cur);

    const itemsHtml = items.map(it => {
      const price = cur === 'ISK' ? it.priceIsk : it.priceEur;
      const title = it.variantLabel
        ? `${_esc(it.name)} — ${_esc(it.variantLabel)}`
        : _esc(it.name);
      return `
        <li class="shop-checkout__item">
          <span>${title} × ${it.qty}</span>
          <span>${cart.formatMoney(price * it.qty, cur)}</span>
        </li>`;
    }).join('');

    this._view.innerHTML = `
      <div class="shop-checkout__inner">
        <a href="#/cart" class="shop-checkout__back">← Back to cart</a>
        <h1 class="shop-checkout__title">Checkout</h1>

        <div class="shop-checkout__grid">
          <form class="shop-checkout__form" id="shop-checkout-form" novalidate>
            ${user ? `
              <p class="shop-checkout__logged-in">
                Signed in as <strong>${_esc(user.email || user.username)}</strong>.
              </p>
            ` : `
              <fieldset class="shop-checkout__fieldset">
                <legend>Contact</legend>
                <label>Email
                  <input type="email" name="guest_email" required maxlength="254" autocomplete="email"/>
                </label>
                <label>Full name
                  <input type="text" name="guest_name" required maxlength="100" autocomplete="name"/>
                </label>
              </fieldset>
            `}

            <fieldset class="shop-checkout__fieldset">
              <legend>Delivery</legend>
              <div class="shop-checkout__radios">
                <label>
                  <input type="radio" name="shipping_method" value="flat_rate" checked/>
                  <span>Shipping
                    <em class="shop-checkout__rate">
                      ${cart.formatMoney(cur === 'ISK' ? this._shippingRates.flat_rate.priceIsk : this._shippingRates.flat_rate.priceEur, cur)}
                    </em>
                  </span>
                </label>
                <label>
                  <input type="radio" name="shipping_method" value="local_pickup"/>
                  <span>Local pickup
                    <em class="shop-checkout__rate">Free</em>
                  </span>
                </label>
              </div>
            </fieldset>

            <fieldset class="shop-checkout__fieldset" id="shop-checkout-address">
              <legend>Shipping address</legend>
              <label>Name on delivery
                <input type="text" name="name" required maxlength="100" autocomplete="shipping name"/>
              </label>
              <label>Address line 1
                <input type="text" name="line1" required maxlength="200" autocomplete="shipping address-line1"/>
              </label>
              <label>Address line 2 (optional)
                <input type="text" name="line2" maxlength="200" autocomplete="shipping address-line2"/>
              </label>
              <div class="shop-checkout__row">
                <label>City
                  <input type="text" name="city" required maxlength="100" autocomplete="shipping address-level2"/>
                </label>
                <label>Postal code
                  <input type="text" name="postal" required maxlength="20" autocomplete="shipping postal-code"/>
                </label>
              </div>
              <label>Country
                <select name="country" required autocomplete="shipping country">
                  ${COUNTRIES.map(c => `<option value="${c.code}" ${c.code === 'IS' ? 'selected' : ''}>${_esc(c.name)}</option>`).join('')}
                </select>
              </label>
              <label>Phone (optional)
                <input type="tel" name="phone" maxlength="30" autocomplete="shipping tel"/>
              </label>
            </fieldset>

            <p class="shop-checkout__error" id="shop-checkout-error" role="alert"></p>

            <button type="submit" class="shop-checkout__submit" id="shop-checkout-submit"
                    data-testid="checkout-submit">
              Pay ${cart.formatMoney(subtotal + (cur === 'ISK' ? this._shippingRates.flat_rate.priceIsk : this._shippingRates.flat_rate.priceEur), cur)}
            </button>
            <p class="shop-checkout__vat-note">Prices include 24% VAT. You will be redirected to Stripe to complete payment.</p>
          </form>

          <aside class="shop-checkout__summary">
            <h2>Order summary</h2>
            <ul class="shop-checkout__items">${itemsHtml}</ul>
            <div class="shop-checkout__summary-total">
              <span>Subtotal</span>
              <span id="shop-checkout-subtotal">${cart.formatMoney(subtotal, cur)}</span>
            </div>
            <div class="shop-checkout__summary-total">
              <span>Shipping</span>
              <span id="shop-checkout-shipping-total"></span>
            </div>
            <div class="shop-checkout__summary-grand">
              <span>Total</span>
              <span id="shop-checkout-grand"></span>
            </div>
          </aside>
        </div>
      </div>
    `;

    const form = this._view.querySelector('#shop-checkout-form');
    const addressFieldset = this._view.querySelector('#shop-checkout-address');
    const submitBtn = this._view.querySelector('#shop-checkout-submit');
    const errorEl = this._view.querySelector('#shop-checkout-error');

    const syncShipping = () => {
      const method = form.elements['shipping_method'].value;
      this._shippingMethod = method;
      const requiresAddr = method === 'flat_rate';
      addressFieldset.style.display = requiresAddr ? '' : 'none';
      for (const inp of addressFieldset.querySelectorAll('input[required], select[required]')) {
        inp.required = requiresAddr;
      }
      const shippingAmt = requiresAddr
        ? (cur === 'ISK' ? this._shippingRates.flat_rate.priceIsk : this._shippingRates.flat_rate.priceEur)
        : 0;
      this._view.querySelector('#shop-checkout-shipping-total').textContent = cart.formatMoney(shippingAmt, cur);
      this._view.querySelector('#shop-checkout-grand').textContent = cart.formatMoney(subtotal + shippingAmt, cur);
      submitBtn.textContent = `Pay ${cart.formatMoney(subtotal + shippingAmt, cur)}`;
    };
    form.addEventListener('change', (e) => {
      if (e.target.name === 'shipping_method') syncShipping();
    });
    syncShipping();

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorEl.textContent = '';
      submitBtn.disabled = true;
      submitBtn.textContent = 'Redirecting to payment…';

      const fd = new FormData(form);
      const shipping_method = fd.get('shipping_method');
      const requiresAddr = shipping_method === 'flat_rate';

      const body = {
        items: cart.list().map(it => it.variantId
          ? { variantId: it.variantId, quantity: it.qty }
          : { productId: it.productId, quantity: it.qty }),
        currency: cur,
        shipping_method,
      };
      if (!user) {
        body.guest_email = String(fd.get('guest_email') || '').trim();
        body.guest_name  = String(fd.get('guest_name') || '').trim();
      }
      if (requiresAddr) {
        body.shipping_address = {
          name:    String(fd.get('name') || '').trim(),
          line1:   String(fd.get('line1') || '').trim(),
          line2:   String(fd.get('line2') || '').trim() || null,
          city:    String(fd.get('city') || '').trim(),
          postal:  String(fd.get('postal') || '').trim(),
          country: String(fd.get('country') || '').trim(),
          phone:   String(fd.get('phone') || '').trim() || null,
        };
      }

      try {
        const headers = await getCsrfHeaders();
        const res = await fetch('/api/v1/shop/checkout', {
          method: 'POST',
          credentials: 'include',
          headers,
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Checkout failed');
        if (!data.url) throw new Error('No checkout URL returned');
        window.location.assign(data.url);
      } catch (err) {
        errorEl.textContent = err.message;
        submitBtn.disabled = false;
        syncShipping();
      }
    });
  }

  destroy() {}
}

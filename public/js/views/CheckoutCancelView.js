// CheckoutCancelView — customer cancelled at Stripe. Route: #/checkout/cancel
export class CheckoutCancelView {
  constructor() { this._view = null; }

  async render() {
    this._view = document.createElement('div');
    this._view.className = 'view shop-cancel';
    this._view.innerHTML = `
      <div class="shop-cancel__inner">
        <h1>Checkout cancelled</h1>
        <p>Your cart is still here if you'd like to finish the order.</p>
        <div class="shop-cancel__actions">
          <a href="#/cart" class="shop-cancel__btn">Return to cart</a>
          <a href="#/shop" class="shop-cancel__link">Continue shopping</a>
        </div>
      </div>
    `;
    return this._view;
  }

  destroy() {}
}

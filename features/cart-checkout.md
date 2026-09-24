---
id: cart-checkout
name: {is: "Verslun, karfa og greiðsla", en: "Storefront, cart and checkout"}
domain: 11
owner: engine
status: hidden
flag: modules.shop.enabled
paths:
  - server/routes/shopRoutes.js
  - server/controllers/shopController.js
  - server/services/stripeService.js
  - server/config/stripe.js
  - server/config/shipping.js
  - public/js/views/ShopView.js
  - public/js/views/ProductView.js
  - public/js/views/CartView.js
  - public/js/views/CheckoutView.js
  - public/js/views/CheckoutSuccessView.js
  - public/js/views/CheckoutCancelView.js
  - public/js/components/ProductCard.js
  - public/js/components/ShopFilters.js
  - public/js/components/CartIcon.js
  - public/js/components/CurrencySelector.js
  - public/js/services/cart.js
  - public/js/utils/availability.js
  - public/css/shop.css
  - tests/integration/shop.test.js
  - tests/unit/shopFilters.test.js
  - tests/unit/availability.client.test.js
  - e2e/cart-sold-out.spec.js
migrations: []
since: 2026-08-09
origin: null
history: [ui-kit, harvest-2, harvest-ice-c-2026-09-24]
---

The public storefront (`/shop`, product pages, filters), the client-side cart, currency selector and the Stripe Checkout hand-off with webhook-driven order creation. `/shop` is in `publicSurface.js` here; Stripe is inert without keys.

**Rules**
- Stripe webhook signatures are verified (invariant 7); checkout `required` must be re-applied after `syncShipping()`.
- The public catalogue sends `available` only (never on hand or committed). The cart and the checkout flag a line Available cannot cover and block checkout (`utils/availability.js`); the server answers 409 for it; the webhook re-checks under the row locks and refunds a payment that would oversell ([history](../docs/HISTORY.md#harvest-ice-c-2026-09-24), ENHANCEMENTS #25).
- The search box toggles its buttons in place, never repaints under the typist (ice #350).
- Full rules: [../docs/ARCHITECTURE.md#11-shop--cart-checkout-orders-products-collections-bins-discounts-hidden-surface](../docs/ARCHITECTURE.md#11-shop--cart-checkout-orders-products-collections-bins-discounts-hidden-surface).

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
  - public/css/shop.css
  - tests/integration/shop.test.js
  - tests/unit/shopFilters.test.js
migrations: []
since: 2026-08-09
origin: null
history: [ui-kit, harvest-2]
---

The public storefront (`/shop`, product pages, filters), the client-side cart, currency selector and the Stripe Checkout hand-off with webhook-driven order creation. `/shop` is in `publicSurface.js` here; Stripe is inert without keys.

**Rules**
- Stripe webhook signatures are verified (invariant 7); checkout `required` must be re-applied after `syncShipping()`.
- A sold-out cart line currently goes straight to Stripe (ENHANCEMENTS #25).
- Full rules: [../docs/ARCHITECTURE.md#11-shop--cart-checkout-orders-products-collections-bins-discounts-hidden-surface](../docs/ARCHITECTURE.md#11-shop--cart-checkout-orders-products-collections-bins-discounts-hidden-surface).

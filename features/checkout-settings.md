---
id: checkout-settings
name: {is: "Stillingar greiðsluferlis", en: "Checkout settings"}
domain: 11
owner: engine
status: hidden
flag: modules.shop.enabled
paths:
  - server/routes/adminCheckoutSettingsRoutes.js
  - server/controllers/adminCheckoutSettingsController.js
  - server/services/checkoutRules.js
  - public/js/views/AdminCheckoutSettingsView.js
  - public/js/services/adminCheckoutSettings.js
  - public/js/utils/checkoutSettings.js
  - public/css/admin-checkout-settings.css
  - tests/integration/checkoutSettings.test.js
  - tests/unit/checkoutRulesCoverage.test.js
  - tests/unit/checkoutSettings.client.test.js
  - e2e/checkout-settings.spec.js
migrations: []
since: 2026-09-26
origin: null
history: [harvest2-lane7a-2026-09-26]
---

Admin → Greiðsla (`/admin/checkout`, admin view `checkout`, ported from icelandicstore #151): the ordering pause and its per-language message, the minimum order value, the delivery price (flat rate + a free-over threshold, the env as the fallback until saved), the checkout field rules (phone, company, kennitala, note — optional / required / hidden) and the owner's paid-order alert list. Every value is enforced on the SERVER by `services/checkoutRules.js` on the order path; the cart and the checkout only show them (`utils/checkoutSettings.js`). Hidden here with the rest of the retail surface. See [the history](../docs/history.d/2026-09-26-harvest2-lane7a-checkout-settings.md#harvest2-lane7a-2026-09-26).

**Rules**
- Every order-create path runs, in order: the pause (503 `ORDERING_PAUSED`, before any order work), the field rules (hidden values dropped, required ones present, a kennitala shape- and check-digit-valid), the minimum on the DB-trusted subtotal AFTER the order discount, measured in ISK (400 `MIN_ORDER_VALUE` with the amount). `tests/unit/checkoutRulesCoverage.test.js` fails when a caller of `Order.createWithItems` appears without them.
- The owner alert is sent where the order becomes paid (the Stripe webhook), best-effort and NOT awaited: it can never fail or hold up the webhook's 200. It goes through `emailService.deliver` (EMAIL_ALLOWLIST, the demo no-send rule). The list is admin-only, never in `/shop/config`.
- A save validates every group before it writes any, then writes them in one transaction.
- Company and kennitala are validated but not stored on the order (no column; owed), so the admin API refuses `required` for them until the storage lands.
- Full rules: [../docs/ARCHITECTURE.md#11-shop--cart-checkout-orders-products-collections-bins-discounts-hidden-surface](../docs/ARCHITECTURE.md#11-shop--cart-checkout-orders-products-collections-bins-discounts-hidden-surface).

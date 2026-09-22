---
id: discounts
name: {is: "Afslættir", en: Discounts}
domain: 11
owner: engine
status: hidden
flag: null
paths:
  - server/routes/adminDiscountRoutes.js
  - server/controllers/adminDiscountController.js
  - server/models/Discount.js
  - server/services/discountEngine.js
  - public/js/views/AdminDiscountsView.js
  - public/js/services/adminDiscounts.js
  - public/css/admin-discounts.css
  - tests/integration/discounts.test.js
  - tests/unit/discountEngine.test.js
migrations: [050_discounts, 055_discount_types]
since: 2026-08-09
origin: null
history: []
---

Discount codes and automatic discounts (050, types in 055) evaluated by `discountEngine` at checkout, managed at `/admin/discounts`. The discount limiter is deliberately not x5.

**Rules**
- Full rules: [../docs/ARCHITECTURE.md#11-shop--cart-checkout-orders-products-collections-bins-discounts-hidden-surface](../docs/ARCHITECTURE.md#11-shop--cart-checkout-orders-products-collections-bins-discounts-hidden-surface).

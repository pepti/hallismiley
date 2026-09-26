---
id: orders
name: {is: Pantanir, en: Orders}
domain: 11
owner: engine
status: hidden
flag: modules.shop.enabled
paths:
  - server/models/Order.js
  - server/services/orderExport.js
  - server/utils/qr.js
  - public/js/views/AdminOrdersView.js
  - public/js/views/AdminOrderDetailView.js
  - public/js/views/AdminSalesView.js
  - public/js/views/OrderHistoryView.js
  - public/js/services/adminOrders.js
  - public/css/admin-orders.css
  - public/css/admin-sales.css
  - tests/integration/adminOrderBulk.test.js
  - tests/integration/adminOrderExport.test.js
  - tests/unit/qr.test.js
migrations: [054_order_payment_fulfillment_tags, 115_order_notes]
since: 2026-08-09
origin: null
history: [ui-kit, harvest-ice-c-2026-09-24, harvest-ice-d-2026-09-24, harvest2-lane4b-2026-09-26]
---

Orders after checkout: the admin list with payment/fulfilment/tags (054) and bulk actions, the order detail, the sales overview, and the customer's own order history. Order invoices are issued by `invoices`.

**Rules**
- The buyer's checkout note lives in `orders.notes` (migration 115, ice #213): trimmed and cut at 1000 characters by `Order.normaliseNote`, shown to staff on the admin order page, never in `COLUMNS` / the customer-facing payloads ([history](../docs/history.d/2026-09-26-harvest2-lane4b-shop-i18n.md#harvest2-lane4b-2026-09-26)). The admin order page also shows the VAT per rate under the total (`utils/vat.js`).
- Full rules: [../docs/ARCHITECTURE.md#11-shop--cart-checkout-orders-products-collections-bins-discounts-hidden-surface](../docs/ARCHITECTURE.md#11-shop--cart-checkout-orders-products-collections-bins-discounts-hidden-surface).

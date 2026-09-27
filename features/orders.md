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
  - server/services/deliveryNote.js
  - server/utils/variantLabel.js
  - server/utils/skuCompare.js
  - tests/unit/deliveryNotePdf.test.js
  - tests/unit/variantLabel.test.js
  - tests/unit/skuCompare.test.js
  - server/utils/orderVat.js
  - server/utils/reportWindow.js
  - server/models/SalesReports.js
  - public/js/utils/dateRanges.js
  - tests/integration/orderVatSnapshot.test.js
  - tests/integration/adminSalesReport.test.js
  - tests/unit/orderVatParity.test.js
  - tests/unit/dateRanges.client.test.js
  - tests/unit/reportWindow.test.js
  - e2e/admin-sales-report.spec.js
migrations: [054_order_payment_fulfillment_tags, 115_order_notes, 121_order_vat_snapshot]
since: 2026-08-09
origin: null
history: [ui-kit, harvest-ice-c-2026-09-24, harvest-ice-d-2026-09-24, harvest2-lane4b-2026-09-26, harvest2-lane6c-2026-09-26, harvest2-lane5-2026-09-26]
---

Orders after checkout: the admin list with payment/fulfilment/tags (054) and bulk actions, the order detail, the sales overview, and the customer's own order history. Order invoices are issued by `invoices`.

**Rules**
- The buyer's checkout note lives in `orders.notes` (migration 115, ice #213): trimmed and cut at 1000 characters by `Order.normaliseNote`, shown to staff on the admin order page, never in `COLUMNS` / the customer-facing payloads ([history](../docs/history.d/2026-09-26-harvest2-lane4b-shop-i18n.md#harvest2-lane4b-2026-09-26)). The admin order page also shows the VAT per rate under the total (`utils/vat.js`).
- The delivery note is a pick list (harvest 2 lane 6c, [history](../docs/history.d/2026-09-26-harvest2-lane6c-variants.md#harvest2-lane6c-2026-09-26)): lines walked by BIN then SKU, a BIN and a SKU column, the size under the name (never twice), a 120 px picture per line — `services/deliveryNote.js` loads them (at most four decodes at once) and `pdfService` embeds each picture once per PDF.
- The VAT inside an order is snapshotted at checkout (migration 121: `order_items.vat_rate`, `orders.vat_total`) by `server/utils/orderVat.js`, the core `invoiceService.buildLines` also runs — for an ISK order the snapshot equals the booked VAT. The sales report (`/admin/sales`) leads with net sales per currency, counts an order when PAID, compares with a preset's comparison window, and loads its insights and marketing sections as separate requests; the "Í dag" to-fulfil card and the order list's `?view=open` share `Order.ORDER_VIEWS.open` (the sold-out card counts the Inventory Watch's `out` bucket — [history](../docs/history.d/2026-09-26-harvest2-lane5-reports.md#harvest2-lane5-2026-09-26)).
- Full rules: [../docs/ARCHITECTURE.md#11-shop--cart-checkout-orders-products-collections-bins-discounts-hidden-surface](../docs/ARCHITECTURE.md#11-shop--cart-checkout-orders-products-collections-bins-discounts-hidden-surface).

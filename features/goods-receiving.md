---
id: goods-receiving
name: {is: "Vörumóttaka", en: "Goods receiving"}
domain: 11
owner: engine
status: hidden
flag: modules.shop.enabled
paths:
  - server/routes/adminReceivingRoutes.js
  - server/controllers/adminReceivingController.js
  - server/models/GoodsReceipt.js
  - public/js/views/AdminReceivingView.js
  - public/js/views/AdminReceivingDetailView.js
  - public/js/services/adminReceiving.js
  - tests/integration/goodsReceipts.test.js
migrations: [118_goods_receipts]
since: 2026-09-26
origin: null
history: [harvest2-lane6a-2026-09-26]
---

A supplier delivery checked in against the supplier's own file (`/admin/receiving`, admin view `receiving`, ported from icelandicstore #23): a draft receipt, the supplier's lines read from a .csv/.xlsx/.pdf through the one product-file reader and matched to our catalogue by SKU then barcode, a scan log of what arrived, shorts / overs / not-on-invoice, and a finalise that moves stock ONCE as one audited batch. Hidden here with the rest of the retail surface; live in a retail downstream. See [the history](../docs/history.d/2026-09-26-harvest2-lane6a-stock.md#harvest2-lane6a-2026-09-26).

**Rules**
- Lines match by OUR code only — a variant's SKU, a product's SKU, then a barcode; a code on two rows, an unknown code or a variant product's own code stays `unmatched` for a person (no fuzzy matcher).
- Finalise is one transaction under the receipt's row lock: status check, `Inventory.applyBatch` (reason `receipt`, the receipt on every row, one `batch_id`) and the flip to `finalized` commit together; a second finalise is 409 `ALREADY_FINALIZED` and moves nothing. Stock moves by what was RECEIVED, never what was expected.
- An unmatched counted line blocks finalise (409 `INCOMPLETE`) until it is matched or skipped; not-on-invoice scans are received unless excluded.
- Full rules: [../docs/ARCHITECTURE.md#11-shop--cart-checkout-orders-products-collections-bins-discounts-hidden-surface](../docs/ARCHITECTURE.md#11-shop--cart-checkout-orders-products-collections-bins-discounts-hidden-surface).

---
id: shop-catalog
name: {is: "Vörulisti", en: "Shop catalog"}
domain: 11
owner: engine
status: hidden
flag: modules.shop.enabled
paths:
  - server/routes/adminShopRoutes.js
  - server/controllers/adminShopController.js
  - server/routes/adminBinsRoutes.js
  - server/controllers/adminBinsController.js
  - server/models/Product.js
  - server/models/ProductVariant.js
  - server/models/Collection.js
  - server/models/Bin.js
  - server/models/Inventory.js
  - server/routes/adminInventoryRoutes.js
  - server/controllers/adminInventoryController.js
  - server/utils/inventoryStatus.js
  - server/services/productImport/**
  - server/utils/variantAxis.js
  - public/js/views/AdminProductsView.js
  - public/js/views/AdminCollectionsView.js
  - public/js/views/AdminBinsView.js
  - public/js/views/AdminInventoryView.js
  - public/js/views/AdminStockCountView.js
  - public/js/components/BarcodeScanner.js
  - public/js/services/adminProducts.js
  - public/js/services/adminCollections.js
  - public/js/services/adminBins.js
  - public/js/services/adminInventory.js
  - public/js/utils/stockUnits.js
  - public/js/utils/imageUrl.js
  - server/scripts/seed-shop.js
  - server/scripts/import-products-csv.js
  - server/scripts/seed-assets/**
  - public/css/admin-products.css
  - public/css/admin-collections.css
  - public/css/admin-bins.css
  - public/css/admin-stock.css
  - public/css/barcode-scanner.css
  - tests/integration/adminProductImportExport.test.js
  - tests/integration/inventoryThreeNumbers.test.js
  - tests/integration/adminInventory.test.js
  - tests/unit/inventoryStatus.test.js
  - tests/integration/adminProductImportFile.test.js
  - tests/unit/productImportParseFile.test.js
  - tests/unit/productImportVariantCell.test.js
  - tests/unit/productImportVariantGroups.test.js
  - tests/unit/parsePdfWorker.test.js
  - tests/unit/imageUrl.test.js
  - tests/fixtures/pdfFixture.js
  - tests/unit/bins-grid.test.js
  - e2e/admin-product-group.spec.js
  - e2e/admin-stock.spec.js
migrations: [022_ecommerce, 023_product_taxonomy, 024_product_variants, 025_shop_content, 045_shop_sections, 048_product_codes, 049_collections, 057_product_bin, 074_product_vat_rate, 112_inventory_adjustments, 113_variant_barcode]
since: 2026-08-09
origin: null
history: [harvest-2, ui-kit, harvest-ice-c-2026-09-24, harvest-ice-d-2026-09-24, harvest2-lane6a-2026-09-26]
---

Products, variants, taxonomy, product codes, collections, stock bins and the barcode scanner: the admin side of the shop (`/api/v1/admin/shop`, `/api/v1/admin/bins`) with CSV import/export. Hidden here (every line in `HIDDEN_ADMIN_VIEWS`); fully live in a retail downstream.

**Rules**
- Hidden, never deleted; routes live.
- Three numbers: `stock` is On hand; Committed is derived from PAID orders not yet fulfilled (`orders.stock_deducted_at IS NULL`); Available = On hand − Committed. `stock >= 0` stays (no overselling). Every change of on hand goes through `models/Inventory.js` (`applyLines` / `setAbsolute`) and leaves an `inventory_adjustments` row with the actor and the reason; opening stock is an `opening` row ([history](../docs/HISTORY.md#harvest-ice-c-2026-09-24)).
- Lock order: orders row → parent products (KEY SHARE) → variants → products, each sorted; a status-less 40P01 is a retryable 409 `BUSY`.
- Inventory Watch (`/admin/inventory`, view `inventory`) buckets each stocked unit on Available over 90 days of PAID order lines; "Fix stock" and the stock count (`/admin/stock-count`) write only through `Inventory.correct` / `Inventory.applyBatch` — a count is ONE batch (one `batch_id`), all or nothing, every below-zero line named, a re-sent client token refused ([history](../docs/history.d/2026-09-26-harvest2-lane6a-stock.md#harvest2-lane6a-2026-09-26)).
- Bulk edit (`POST /products/bulk`) sets type, subcategory, VAT rate, status and bin only — never name, price or stock.
- The 4 MB import body is parsed only after the admin gate, limiters and CSRF, and sanitized there ([history](../docs/HISTORY.md#ready-and-import-order-2026-09-23)).
- Every product file (CSV, .xlsx, PDF) is read on the SERVER by `services/productImport` (`POST /products/import/parse-file`, memory-only, 10 MB); SKU then Barcode is the match key, an ambiguous or duplicate code is refused, an order quantity is never stock; rows with a Variant cell create one Draft product with its variants, whole or not at all, only with `create: true` ([history](../docs/HISTORY.md#harvest-ice-d-2026-09-24)).
- Full rules: [../docs/ARCHITECTURE.md#11-shop--cart-checkout-orders-products-collections-bins-discounts-hidden-surface](../docs/ARCHITECTURE.md#11-shop--cart-checkout-orders-products-collections-bins-discounts-hidden-surface).

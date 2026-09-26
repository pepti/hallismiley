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
  - server/services/productImport/**
  - server/utils/variantAxis.js
  - public/js/views/AdminProductsView.js
  - public/js/views/AdminCollectionsView.js
  - public/js/views/AdminBinsView.js
  - public/js/components/BarcodeScanner.js
  - public/js/services/adminProducts.js
  - public/js/services/adminCollections.js
  - public/js/services/adminBins.js
  - public/js/utils/imageUrl.js
  - server/scripts/seed-shop.js
  - server/scripts/import-products-csv.js
  - server/scripts/seed-assets/**
  - public/css/admin-products.css
  - public/css/admin-collections.css
  - public/css/admin-bins.css
  - public/css/barcode-scanner.css
  - tests/integration/adminProductImportExport.test.js
  - tests/integration/inventoryThreeNumbers.test.js
  - tests/integration/adminProductImportFile.test.js
  - tests/unit/productImportParseFile.test.js
  - tests/unit/productImportVariantCell.test.js
  - tests/unit/productImportVariantGroups.test.js
  - tests/unit/parsePdfWorker.test.js
  - tests/unit/imageUrl.test.js
  - tests/fixtures/pdfFixture.js
  - tests/unit/bins-grid.test.js
  - e2e/admin-product-group.spec.js
  - public/js/components/VariantGrid.js
  - public/js/utils/variantArrange.js
  - public/js/utils/variantSort.js
  - public/js/utils/variantAddValue.js
  - public/js/utils/variantAxis.js
  - public/js/utils/colorMatch.js
  - server/utils/colorMatch.js
  - server/services/variantAdd.js
  - tests/unit/colorMatch.test.js
  - tests/unit/variantArrange.client.test.js
  - tests/unit/variantSort.client.test.js
  - tests/unit/variantAddValue.client.test.js
  - tests/unit/variantAxisParity.test.js
  - tests/integration/adminShopVariants.test.js
  - e2e/admin-product-variants.spec.js
  - e2e/shop-colour-swatch.spec.js
migrations: [022_ecommerce, 023_product_taxonomy, 024_product_variants, 025_shop_content, 045_shop_sections, 048_product_codes, 049_collections, 057_product_bin, 074_product_vat_rate, 112_inventory_adjustments, 113_variant_barcode, 119_product_image_color]
since: 2026-08-09
origin: null
history: [harvest-2, ui-kit, harvest-ice-c-2026-09-24, harvest-ice-d-2026-09-24, harvest2-lane6c-2026-09-26]
---

Products, variants, taxonomy, product codes, collections, stock bins and the barcode scanner: the admin side of the shop (`/api/v1/admin/shop`, `/api/v1/admin/bins`) with CSV import/export. Hidden here (every line in `HIDDEN_ADMIN_VIEWS`); fully live in a retail downstream.

**Rules**
- Hidden, never deleted; routes live.
- Three numbers: `stock` is On hand; Committed is derived from PAID orders not yet fulfilled (`orders.stock_deducted_at IS NULL`); Available = On hand − Committed. `stock >= 0` stays (no overselling). Every change of on hand goes through `models/Inventory.js` (`applyLines` / `setAbsolute`) and leaves an `inventory_adjustments` row with the actor and the reason; opening stock is an `opening` row ([history](../docs/HISTORY.md#harvest-ice-c-2026-09-24)).
- Lock order: orders row → parent products (KEY SHARE) → variants → products, each sorted; a status-less 40P01 is a retryable 409 `BUSY`.
- Bulk edit (`POST /products/bulk`) sets type, subcategory, VAT rate, status and bin only — never name, price or stock.
- The 4 MB import body is parsed only after the admin gate, limiters and CSRF, and sanitized there ([history](../docs/HISTORY.md#ready-and-import-order-2026-09-23)).
- Every product file (CSV, .xlsx, PDF) is read on the SERVER by `services/productImport` (`POST /products/import/parse-file`, memory-only, 10 MB); SKU then Barcode is the match key, an ambiguous or duplicate code is refused, an order quantity is never stock; rows with a Variant cell create one Draft product with its variants, whole or not at all, only with `create: true` ([history](../docs/HISTORY.md#harvest-ice-d-2026-09-24)).
- Variants (harvest 2 lane 6c, [history](../docs/history.d/2026-09-26-harvest2-lane6c-variants.md#harvest2-lane6c-2026-09-26)): the editor grid is `components/VariantGrid.js` (add, edit, delete, colour → size order, header sorting, "+ Add a colour"); DELETE deletes a variant nothing names and archives one an order or the stock history names — an archived row frees its SKU and option slot (migration 119) and leaves every list; `POST /products/:id/variants/bulk` adds many whole or not at all (`services/variantAdd.js`, shared with MCP `add_variants`).
- Which photo a colour shows is matched on the server only (`utils/colorMatch.js` → `color_images`); the admin tags a photo with one of the product's active colours (`product_images.color`, 119).
- Full rules: [../docs/ARCHITECTURE.md#11-shop--cart-checkout-orders-products-collections-bins-discounts-hidden-surface](../docs/ARCHITECTURE.md#11-shop--cart-checkout-orders-products-collections-bins-discounts-hidden-surface).

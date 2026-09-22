---
id: shop-catalog
name: {is: "Vörulisti", en: "Shop catalog"}
domain: 11
owner: engine
status: hidden
flag: null
paths:
  - server/routes/adminShopRoutes.js
  - server/controllers/adminShopController.js
  - server/routes/adminBinsRoutes.js
  - server/controllers/adminBinsController.js
  - server/models/Product.js
  - server/models/ProductVariant.js
  - server/models/Collection.js
  - server/models/Bin.js
  - public/js/views/AdminProductsView.js
  - public/js/views/AdminCollectionsView.js
  - public/js/views/AdminBinsView.js
  - public/js/components/BarcodeScanner.js
  - public/js/services/adminProducts.js
  - public/js/services/adminCollections.js
  - public/js/services/adminBins.js
  - public/js/utils/productCsv.js
  - server/scripts/seed-shop.js
  - server/scripts/import-products-csv.js
  - server/scripts/seed-assets/**
  - public/css/admin-products.css
  - public/css/admin-collections.css
  - public/css/admin-bins.css
  - public/css/barcode-scanner.css
  - tests/integration/adminProductImportExport.test.js
  - tests/unit/bins-grid.test.js
  - e2e/admin-product-group.spec.js
migrations: [022_ecommerce, 023_product_taxonomy, 024_product_variants, 025_shop_content, 045_shop_sections, 048_product_codes, 049_collections, 057_product_bin, 074_product_vat_rate]
since: 2026-08-09
origin: null
history: [harvest-2, ui-kit]
---

Products, variants, taxonomy, product codes, collections, stock bins and the barcode scanner: the admin side of the shop (`/api/v1/admin/shop`, `/api/v1/admin/bins`) with CSV import/export. Hidden here (every line in `HIDDEN_ADMIN_VIEWS`); fully live in a retail downstream.

**Rules**
- Hidden, never deleted; routes live.
- `stock <= 0` is sold out (negative counts as sold out).
- Full rules: [../docs/ARCHITECTURE.md#11-shop--cart-checkout-orders-products-collections-bins-discounts-hidden-surface](../docs/ARCHITECTURE.md#11-shop--cart-checkout-orders-products-collections-bins-discounts-hidden-surface).

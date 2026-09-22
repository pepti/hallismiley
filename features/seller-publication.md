---
id: seller-publication
name: {is: "Sölusvæði (birt frá rekstri)", en: "Seller area (published from ops)"}
domain: 21
owner: engine
status: live
flag: null
paths:
  - server/routes/sellerPublishRoutes.js
  - server/routes/sellerRoutes.js
  - server/services/sellerPublish/**
  - server/auth/publishedSeller.js
  - server/config/instanceRole.js
  - public/js/views/SellerAreaView.js
  - public/js/services/seller.js
  - public/css/seller-area.css
  - server/scripts/publish-sellers.js
  - tests/integration/sellerArea.test.js
migrations: [105_seller_publication]
since: 2026-09-21
origin: null
history: [seller-area]
---

One-way publication from a private ops instance to a public one: ops builds a signed snapshot of each seller's leads, accounts and commission statements (`npm run publish:sellers`), the public box ingests it into the `published_*` tables (105), and `/solusvaedi` shows a seller their own read-only copy behind 2FA. `INSTANCE_ROLE` (`ops` default / `public`) decides which half a box runs.

**Rules**
- One way only: the public instance has no route that reaches back; the seller API is GET-only over `published_*`.
- Ingest = HMAC over the RAW bytes, 5-minute window, every failure the same 401; a snapshot not newer than the last is 409.
- Never published: rate fields, payee kennitala, Azure/repo internals.
- Full rules: [../docs/ARCHITECTURE.md#21-seller-area--the-published-copy-on-the-public-instance](../docs/ARCHITECTURE.md#21-seller-area--the-published-copy-on-the-public-instance).

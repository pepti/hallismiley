---
id: company-content
name: {is: "Efni fyrirtækisins", en: "Company content"}
domain: 3
owner: os
status: live
flag: null
paths:
  - server/config/product-migrations/os.js
  - server/scripts/seed-sales-guides.js
  - tests/integration/salesGuidesServicesPage.test.js
  - tests/integration/salesGuidesD001.test.js
migrations: [091_home_content_company, 092_contact_content_company, 104_sales_guides_services_page, os_001_sales_guides_d001_pricing]
since: 2026-09-01
origin: null
history: [r1, sales-staff, services-page, handbook-d001-2026-09-22]
---

Orange Smiley's own copy on top of the engine: the seeded homepage and contact rows (091/092), the sales-guide set for Handbók sölufólks (`seed-sales-guides.js` — Orange Smiley, Rekstrarkerfið and Halli by name), the 104 rewrite that took the tier table off the guides after /thjonusta became the services page, and `os_001_sales_guides_d001_pricing`, which moved the seeded guides to D-001's price model (build fee + service contract + verkeiningar) and to the demo instance `demo.rekstrarkerfi.is` (2026-09-22). These are PRODUCT migrations (`server/config/product-migrations/os.js`), never engine ones, so a downstream never inherits this company's words.

**Rules**
- All copy is DRAFT until Halli approves; draft natively in Icelandic.
- Seeded rows are guarded on `updated_by IS NULL` so admin edits survive a re-seed.
- A text change to `seed-sales-guides.js` ships with a product migration that makes the same change to seeded rows (104, os_001); `salesGuidesD001.test.js` checks the seed and os_001 agree.
- Guide prices follow D-001 and stay DRÖG; the handbook sends sellers to `demo.rekstrarkerfi.is` for demos, never to this site.
- No product tiers or prices on the company site (they live on rekstrarkerfi.is).
- Engine context: [../../docs/ARCHITECTURE.md#3-public-site--home-thjonusta-um-okkur-hafa-samband-ssr-meta-sitemap-seo](../../docs/ARCHITECTURE.md#3-public-site--home-thjonusta-um-okkur-hafa-samband-ssr-meta-sitemap-seo), [../../docs/ARCHITECTURE.md#10-sales-handbook--handbók-sölufólks](../../docs/ARCHITECTURE.md#10-sales-handbook--handbók-sölufólks).

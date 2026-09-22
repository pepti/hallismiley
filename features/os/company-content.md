---
id: company-content
name: {is: "Efni fyrirtækisins", en: "Company content"}
domain: 3
owner: os
status: live
flag: null
paths:
  - server/config/product-migrations/**
  - server/scripts/seed-sales-guides.js
  - tests/integration/salesGuidesServicesPage.test.js
migrations: [091_home_content_company, 092_contact_content_company, 104_sales_guides_services_page]
since: 2026-09-01
origin: null
history: [r1, sales-staff, services-page]
---

Orange Smiley's own copy on top of the engine: the seeded homepage and contact rows (091/092), the sales-guide set for Handbók sölufólks (`seed-sales-guides.js` — Orange Smiley, Rekstrarkerfið and Halli by name) and the 104 rewrite that took the tier table off the guides after /thjonusta became the services page. These are PRODUCT migrations (`server/config/product-migrations/os.js`), never engine ones, so a downstream never inherits this company's words.

**Rules**
- All copy is DRAFT until Halli approves; draft natively in Icelandic.
- Seeded rows are guarded on `updated_by IS NULL` so admin edits survive a re-seed.
- No product tiers or prices on the company site (they live on rekstrarkerfi.is).
- Engine context: [../../docs/ARCHITECTURE.md#3-public-site--home-thjonusta-um-okkur-hafa-samband-ssr-meta-sitemap-seo](../../docs/ARCHITECTURE.md#3-public-site--home-thjonusta-um-okkur-hafa-samband-ssr-meta-sitemap-seo), [../../docs/ARCHITECTURE.md#10-sales-handbook--handbók-sölufólks](../../docs/ARCHITECTURE.md#10-sales-handbook--handbók-sölufólks).

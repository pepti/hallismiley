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
  - tests/integration/salesGuidesD022.test.js
  - tests/integration/salesGuidesQueueSpread.test.js
  - tests/integration/contactContentOs002.test.js
migrations: [091_home_content_company, 092_contact_content_company, 104_sales_guides_services_page, os_001_sales_guides_d001_pricing, os_002_contact_content_offering, os_003_sales_guides_d022_pricing, os_004_sales_guides_queue_spread]
since: 2026-09-01
origin: null
history: [r1, sales-staff, services-page, handbook-d001-2026-09-22, handbook-d022-2026-09-26, handbook-queue-spread-2026-09-26]
---

Orange Smiley's own copy on top of the engine: the seeded homepage and contact rows (091/092), the sales-guide set for Handbók sölufólks (`seed-sales-guides.js` — Orange Smiley, Rekstrarkerfið and Halli by name), the 104 rewrite that took the tier table off the guides after /thjonusta became the services page, and `os_001_sales_guides_d001_pricing`, which moved the seeded guides to D-001's price model (build fee + service contract + verkeiningar) and to the demo instance `demo.rekstrarkerfi.is` (2026-09-22), and `os_002_contact_content_offering`, which rewrote the contact page's hero subtitle and "What we take on" cards for the whole company offering with no named software (2026-09-26; the "Undir húddinu" tech-stack section left the page the same day), and `os_003_sales_guides_d022_pricing`, which moved the guides to D-022 (service contract 29/59/89 þ.kr./mán with 2/3/5 verkeiningar, einingaverð 6.000 kr., hosting and in-system AI beyond the included amount at cost + 15 %) and added the fourth tier Samstarf with the free assessment (2026-09-26), and `os_004_sales_guides_queue_spread`, which made the queue note spread a verk bigger than one month's units over several months, with a worked example (2026-09-26). These are PRODUCT migrations (`server/config/product-migrations/os.js`), never engine ones, so a downstream never inherits this company's words.

**Rules**
- All copy is DRAFT until Halli approves; draft natively in Icelandic.
- Seeded rows are guarded on `updated_by IS NULL` so admin edits survive a re-seed.
- A text change to `seed-sales-guides.js` ships with a product migration that makes the same change to seeded rows (104, os_001, os_003, os_004); `salesGuidesD001.test.js`, `salesGuidesD022.test.js` and `salesGuidesQueueSpread.test.js` check the seed and the migrations agree, step by step.
- Guide prices follow D-022 (amends D-001) and stay DRÖG; Samstarf has no listed price and a seller offers the free assessment instead of quoting a tier; the handbook sends sellers to `demo.rekstrarkerfi.is` for demos, never to this site.
- No product tiers or prices on the company site (they live on rekstrarkerfi.is).
- The company site names no software it replaces (Halli, 2026-09-26): categories, not products; the contact form's platform select offers categories too. `contactContentOs002.test.js` checks os_002 and the ContactView defaults agree.
- Engine context: [../../docs/ARCHITECTURE.md#3-public-site--home-thjonusta-um-okkur-hafa-samband-ssr-meta-sitemap-seo](../../docs/ARCHITECTURE.md#3-public-site--home-thjonusta-um-okkur-hafa-samband-ssr-meta-sitemap-seo), [../../docs/ARCHITECTURE.md#10-sales-handbook--handbók-sölufólks](../../docs/ARCHITECTURE.md#10-sales-handbook--handbók-sölufólks).

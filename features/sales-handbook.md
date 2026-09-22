---
id: sales-handbook
name: {is: "Handbók sölufólks", en: "Sales handbook"}
domain: 10
owner: engine
status: live
flag: null
paths:
  - server/routes/salesGuidesRoutes.js
  - server/controllers/salesGuidesController.js
  - public/js/views/AdminHandbookView.js
  - public/js/services/salesGuides.js
  - public/css/admin-handbok.css
  - tests/integration/salesGuides.test.js
  - e2e/sales-handbook.spec.js
  - e2e/lib/salesUser.js
migrations: [090_sales_guides]
since: 2026-08-27
origin: null
history: [sales-staff, services-page]
---

`sales_guides` (090) and `/admin/handbok`: IS-canonical rich-text guides with `_en` siblings, sections and ordering, published by an admin before sales staff (`handbok` view) can read them. The guide CONTENT is the product's — the engine ships the module, the seed lives in `os/company-content`.

**Rules**
- IS-canonical with `_en` siblings; `body_is`/`body_en` are RICH_TEXT_FIELDS; every response `no-store`; nothing public.
- Seeded guides are DRAFTS; publishing is the approval act.
- Full rules: [../docs/ARCHITECTURE.md#10-sales-handbook--handbók-sölufólks](../docs/ARCHITECTURE.md#10-sales-handbook--handbók-sölufólks).

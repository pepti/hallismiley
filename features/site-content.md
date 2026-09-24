---
id: site-content
name: {is: Vefefni, en: "Site content"}
domain: 17
owner: engine
status: live
flag: null
paths:
  - server/routes/contentRoutes.js
  - server/controllers/contentController.js
  - tests/integration/content.uploadImage.test.js
  - e2e/editable-homepage.spec.js
migrations: [005_site_content]
since: 2026-08-09
origin: null
history: [r1, harvest-ice-a-2026-09-24]
---

The `site_content` key/value store (005) behind every editable block: public reads, admin writes, per-key image upload, locale columns. Seeded rows shadow the JS fallbacks; product migrations move the seeded copy.

**Rules**
- `contentController` stamps `updated_by`; seeds leave it null — the guard product content migrations rely on.
- Full rules: [../docs/ARCHITECTURE.md#17-content-settings-background](../docs/ARCHITECTURE.md#17-content-settings-background).

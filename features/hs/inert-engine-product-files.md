---
id: inert-engine-product-files
name: {is: "Óvirkar vöruskrár vélarinnar", en: "The engine's own product files (inert here)"}
domain: 20
owner: hs
status: dormant
flag: null
paths:
  - server/config/product-migrations/os.js
  - server/scripts/seed-sales-guides.js
  - tests/integration/salesGuidesServicesPage.test.js
migrations: []
since: 2026-09-22
origin: null
history: [engine-graft]
---

Orange Smiley's product-owned files that the engine tree carries and every
merge delivers: its migration array (`os.js` — never loaded here,
`migrationSet.js` requires only `<engine.json.product>.js`), the seed script
for its sales handbook (company copy; `features/local.json` hides the
handbook) and the test of its migration 104 (`describe.skip` on any product
but os). They are KEPT, unmodified where possible, because deleting them would
turn every later sync into a delete/modify conflict no merge driver can
resolve. Their registry entry `features/os/company-content.md` is skipped by
`tests/unit/featureRegistry.test.js` as a foreign product folder; this file
claims the paths so the coverage check has exactly one owner.

**Rules**
- Never edit these to make them "fit" hallismiley; never run `os.js`'s
  migrations here. See [engine-graft](../../docs/HISTORY.md#engine-graft).
- Engine context: [../../docs/ARCHITECTURE.md#20-infrastructure-and-cross-cutting](../../docs/ARCHITECTURE.md#20-infrastructure-and-cross-cutting).

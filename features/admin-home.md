---
id: admin-home
name: {is: "Í dag (heimasíða stjórnborðs)", en: "Admin home (Í dag)"}
domain: 2
owner: engine
status: live
flag: null
paths:
  - public/js/views/AdminView.js
  - server/routes/adminHomeRoutes.js
  - server/services/adminHome.js
  - server/services/adminHomeCache.js
  - public/css/admin-idag.css
  - tests/unit/adminHomeCache.test.js
  - tests/unit/adminHomeTodo.client.test.js
  - tests/integration/adminHome.test.js
  - tests/integration/adminHomeAttention.test.js
  - e2e/admin-home.spec.js
migrations: []
since: 2026-09-26
origin: null
history: [admin-home-idag-2026-09-26, harvest2-lane5-2026-09-26, engine-sync-gaps-2026-09-26]
---

The admin home "Í dag" at `/admin` (one read, `GET /api/v1/admin/home`: Bíður þín, Staðan, Nýjast, Fyrstu skrefin; since 2026-09-26, replacing the card overview). Split out of [admin-shell](admin-shell.md) on 2026-09-26 so a product whose `/admin` is its own overview (LedgerLink's ledger overview) records `"admin-home": { "status": "forked", "note": "…" }` in its `features/local.json` and the engine's `e2e/admin-home.spec.js` skips there with the note, while the sidebar and the rest of the shell keep their specs ([history](../docs/history.d/2026-09-26-fix-engine-sync-gaps-2026-09-26.md#engine-sync-gaps-2026-09-26)). The endpoint stays: its integration suites run in every product (they read the identity seam and the module switches, never a product name).

**Rules**
- The admin home is ONE role-gated endpoint (`/api/v1/admin/home`, session + the `dashboard` view): every block is computed server-side only for a view the role holds (`resolveViews`, minus switched-off modules, minus the product's hidden views for a `'*'` holder), and a key the role cannot see is ABSENT from the JSON. A failing source drops its blocks and the answer is still 200 with `errors`. Amounts integer ISK, times ISO UTC, no labels from the server.
- A sales channel rides its view (`orders` web, `invoices` wholesale, `pos` till): a product that hides or switches off all three has no `salesToday` at all, never a zero.
- "Í dag" attention to-dos (sold out, sign-ups awaiting approval, orders to fulfil, open change requests) link to their list FILTERED to exactly the rows counted; a source that cannot be read keeps its row with "—", never 0 ([history](../docs/history.d/2026-09-26-harvest2-lane5-reports.md#harvest2-lane5-2026-09-26)).
- Full rules: [../docs/ARCHITECTURE.md#2-admin-shell--sidebar-dashboard-surface-hiding-ui-kit](../docs/ARCHITECTURE.md#2-admin-shell--sidebar-dashboard-surface-hiding-ui-kit).

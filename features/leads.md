---
id: leads
name: {is: Fyrirspurnir, en: Leads}
domain: 6
owner: engine
status: live
flag: null
paths:
  - server/routes/leadsRoutes.js
  - server/controllers/leadsController.js
  - server/models/Lead.js
  - server/services/leadsCleanup.js
  - server/scripts/leads-export.js
  - server/scripts/leads-import.js
  - public/js/views/AdminLeadsView.js
  - public/js/services/leads.js
  - public/css/admin-leads.css
  - tests/integration/leads.test.js
  - tests/integration/leadsTransfer.test.js
  - tests/unit/leadsRetention.test.js
  - tests/unit/leadRateLimit.test.js
  - e2e/leads.spec.js
migrations: [097_leads]
since: 2026-09-07
origin: null
history: [leads, review-099, leads-transfer-2026-09-22]
---

The lead inbox at `/admin/leads` (`requireView('leads')`): every `/hafa-samband` submission lands in `leads` next to the email, with status, note and owner editable by sales staff; DELETE (erasure) and the CSV export are admin-only. `leadsCleanup` prunes after `LEAD_RETENTION_DAYS` (730). Enquiries captured on another instance reach ops by `npm run leads:export` there and `npm run leads:import` on ops (D-020 step 4).

**Rules**
- `Lead.create()` NEVER throws; submission fields are immutable; PATCH whitelists `status`/`note`/`owner`.
- `contacted_at`/`contacted_by` = FIRST human touch, never restamped.
- Retention 730 days = the 24 months `/personuvernd` §6 promises — change both together.
- Every response `no-store`; no MCP leads tool and no automatic routing without separate sign-off.
- Transfer is one way and insert-only: the export carries submission fields only, the import is `ON CONFLICT (submission_id) DO NOTHING` — an ops row is never updated; the file lives under gitignored `data/` and is deleted after import.
- Full rules: [../docs/ARCHITECTURE.md#6-leads--fyrirspurnir](../docs/ARCHITECTURE.md#6-leads--fyrirspurnir).

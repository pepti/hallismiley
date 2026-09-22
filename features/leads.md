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
  - public/js/views/AdminLeadsView.js
  - public/js/services/leads.js
  - public/css/admin-leads.css
  - tests/integration/leads.test.js
  - tests/unit/leadsRetention.test.js
  - tests/unit/leadRateLimit.test.js
  - e2e/leads.spec.js
migrations: [097_leads]
since: 2026-09-07
origin: null
history: [leads, review-099]
---

The lead inbox at `/admin/leads` (`requireView('leads')`): every `/hafa-samband` submission lands in `leads` next to the email, with status, note and owner editable by sales staff; DELETE (erasure) and the CSV export are admin-only. `leadsCleanup` prunes after `LEAD_RETENTION_DAYS` (730).

**Rules**
- `Lead.create()` NEVER throws; submission fields are immutable; PATCH whitelists `status`/`note`/`owner`.
- `contacted_at`/`contacted_by` = FIRST human touch, never restamped.
- Retention 730 days = the 24 months `/personuvernd` §6 promises — change both together.
- Every response `no-store`; no MCP leads tool and no automatic routing without separate sign-off.
- Full rules: [../docs/ARCHITECTURE.md#6-leads--fyrirspurnir](../docs/ARCHITECTURE.md#6-leads--fyrirspurnir).

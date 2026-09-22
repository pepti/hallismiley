---
id: staff-audit
name: {is: "Aðgerðaskrá starfsfólks", en: "Staff audit log"}
domain: 8
owner: engine
status: live
flag: null
paths:
  - server/routes/adminAuditRoutes.js
  - server/services/staffAudit.js
  - tests/integration/staffAudit.test.js
migrations: []
since: 2026-09-07
origin: null
history: [accounts-commission, review-099]
---

The immutable `staff_audit_log` (created by 098): account, commission and role writes append a row on the same DB client as the write; `/api/v1/admin/audit` reads it for the Monitoring screen.

**Rules**
- The log is immutable and written on the SAME client as the change it records.
- Full rules: [../docs/ARCHITECTURE.md#8-customer-accounts-commission-staff-audit](../docs/ARCHITECTURE.md#8-customer-accounts-commission-staff-audit).

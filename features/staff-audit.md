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
history: [accounts-commission, review-099, harvest2-lane1b-2026-09-26]
---

The immutable `staff_audit_log` (created by 098): account, commission and role writes append a row on the same DB client as the write; `/api/v1/admin/audit` reads it for the Monitoring screen.

**Rules**
- The log is immutable and written on the SAME client as the change it records.
- `ACTIONS` is a closed vocabulary; a new action name is added to it in the same change that writes it (`recordSafe` swallows `record()`'s refusal — `user.totp_reset` and `user.password_replaced` were lost that way until 2026-09-26). Since harvest2 lane 1b the vocabulary also has `role.created`, `role.deleted` and `user.deleted`.
- Full rules: [../docs/ARCHITECTURE.md#8-customer-accounts-commission-staff-audit](../docs/ARCHITECTURE.md#8-customer-accounts-commission-staff-audit).

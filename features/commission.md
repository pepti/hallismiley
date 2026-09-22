---
id: commission
name: {is: "Söluþóknun", en: Commission}
domain: 8
owner: engine
status: live
flag: null
paths:
  - server/routes/adminCommissionRoutes.js
  - server/models/Commission.js
  - server/services/commissionStatements.js
  - server/auth/commissionScope.js
  - public/js/views/AdminCommissionView.js
  - public/js/views/AdminStatementView.js
  - public/js/components/CommissionStatement.js
  - public/js/services/commission.js
  - tests/integration/commission.test.js
  - tests/integration/commissionStatements.test.js
migrations: [102_commission_settlement]
since: 2026-09-07
origin: null
history: [accounts-commission, review-099, migrations-100-102]
---

Commission events snapshotted per invoice (15% build / 10% recurring, D-003), the payable amount (`PAYABLE_NOW_ISK`), and the 102 settlement layer: statements as set differences over a running balance, payouts forked by `payee_kind`, adjustments and 12-month clawback. `commissionScope` limits reading to the seller's own earnings unless a true admin.

**Rules**
- `commissionScope` honours only a true admin — `allaccounts` + `commission` must not read every seller's earnings.
- Statements, lines, payouts and adjustments are append-only; only `amount_paid_isk` moves; every statement/payout write is hard admin.
- Statement status is ONE function (`commissionStatements.statementStatus`) shared with the seller snapshot.
- Full rules: [../docs/ARCHITECTURE.md#8-customer-accounts-commission-staff-audit](../docs/ARCHITECTURE.md#8-customer-accounts-commission-staff-audit).

---
id: payroll
name: {is: Launakerfi, en: Payroll}
domain: 9
owner: engine
status: live
flag: null
paths:
  - server/services/bookkeeping/payrollService.js
  - public/js/views/AdminPayrollView.js
  - tests/integration/booksPayroll.test.js
  - tests/unit/booksPayroll.test.js
migrations: [076_books_payroll_lifecycle, 078_books_payroll_integrity]
since: 2026-08-09
origin: null
history: []
---

Payroll runs (076 lifecycle, 078 integrity): employees, a run per month, the postings into the ledger, and the employee route of a commission payout.

**Rules**
- Full rules: [../docs/ARCHITECTURE.md#9-bookkeeping--invoices-vsk-peppol-intake-settings-replay-payroll](../docs/ARCHITECTURE.md#9-bookkeeping--invoices-vsk-peppol-intake-settings-replay-payroll).

---
id: books-intake
name: {is: "Innhólf fylgiskjala", en: "Books intake queue"}
domain: 9
owner: engine
status: live
flag: null
paths:
  - server/services/bookkeeping/intakeService.js
  - server/services/bookkeeping/intakeShape.js
  - tests/integration/booksIntake.test.js
  - tests/unit/booksIntakeShape.test.js
migrations: [096_books_capture_spine]
since: 2026-09-06
origin: null
history: [migrations-100-102]
---

The capture spine (096): documents arrive in an intake queue, are shaped and validated (`intakeShape`), then become expenses or invoices from the books screens.

**Rules**
- Full rules: [../docs/ARCHITECTURE.md#9-bookkeeping--invoices-vsk-peppol-intake-settings-replay-payroll](../docs/ARCHITECTURE.md#9-bookkeeping--invoices-vsk-peppol-intake-settings-replay-payroll).

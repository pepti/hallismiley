---
id: bookkeeping-core
name: {is: "Bókhaldskjarni", en: "Bookkeeping core"}
domain: 9
owner: engine
status: live
flag: null
paths:
  - server/routes/adminBookkeepingRoutes.js
  - server/controllers/adminBookkeepingController.js
  - server/models/Expense.js
  - server/models/FxRate.js
  - server/services/bookkeeping/ledgerService.js
  - server/services/bookkeeping/expenseService.js
  - server/services/bookkeeping/reconciliationService.js
  - server/services/bookkeeping/reportService.js
  - server/services/bookkeeping/auditLog.js
  - server/services/bookkeeping/documentService.js
  - server/middleware/booksLimiters.js
  - server/utils/booksDate.js
  - server/utils/fx.js
  - server/utils/csv.js
  - public/js/views/AdminBooksView.js
  - public/js/views/AdminExpensesView.js
  - public/js/views/AdminARView.js
  - public/js/views/AdminBankView.js
  - public/js/views/AdminLedgerView.js
  - public/js/views/booksShared.js
  - public/js/services/adminBookkeeping.js
  - public/js/utils/money.js
  - public/css/admin-bookkeeping.css
  - server/scripts/books-archive-export.js
  - server/scripts/books-backfill-orders.js
  - server/scripts/books-fetch-fx.js
  - server/scripts/seed-books-demo.js
  - tests/integration/adminBookkeeping.test.js
  - tests/integration/booksExpenses.test.js
  - tests/integration/booksLedger.test.js
  - tests/integration/booksReconciliation.test.js
  - tests/integration/booksReports.test.js
  - tests/integration/booksBackfill.test.js
  - tests/integration/booksDeferredRevenue.test.js
  - tests/unit/booksCsv.test.js
  - tests/unit/booksDate.test.js
  - tests/unit/booksFx.test.js
  - tests/unit/booksControllerParse.test.js
  - tests/unit/money.client.test.js
migrations: [072_bookkeeping, 073_books_expenses, 075_books_reconciliation, 101_books_deferred_revenue, 103_books_vehicle_accounts]
since: 2026-08-09
origin: null
history: [accounts-commission, review-099, migrations-100-102, ui-kit]
---

The double-entry books (072): chart of accounts, journal, periods, expenses (073), bank reconciliation (075), reports, the books audit log, deferred revenue / prepayments (101) and the vehicle accounts (103). One router, `/api/v1/admin/bookkeeping`, gates every books view; `booksLimiters` rate-limits the writes. Invoices, VSK, Peppol, intake, payroll, POS and replay are cut into their own features.

**Rules**
- Books rows are append-only under `books_forbid_any_mutation`; statutory documents are never deleted, only credited.
- Build deposit = prepayment on 2150; **2150 never goes debit**; crediting a RELEASED deposit goes against `recognised_into_account`.
- Client money is minor units at the API boundary (`money.js`).
- 6600 atvinnubifreiðar deductible, 6610 fólksbifreiðar blocked (103).
- Full rules: [../docs/ARCHITECTURE.md#9-bookkeeping--invoices-vsk-peppol-intake-settings-replay-payroll](../docs/ARCHITECTURE.md#9-bookkeeping--invoices-vsk-peppol-intake-settings-replay-payroll).

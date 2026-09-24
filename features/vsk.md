---
id: vsk
name: {is: "Virðisaukaskattur", en: "VAT (VSK) returns"}
domain: 9
owner: engine
status: live
flag: modules.books.enabled
paths:
  - server/services/bookkeeping/vatService.js
  - server/utils/vat.js
  - server/utils/vatPeriod.js
  - public/js/views/AdminVatView.js
  - tests/integration/booksVatReturn.test.js
  - tests/unit/booksVat.test.js
  - tests/unit/booksVatPeriod.test.js
migrations: []
since: 2026-08-09
origin: null
history: [migrations-100-102]
---

The Icelandic VSK return: two-month periods (`vatPeriod.js`), the 24%/11% codes, the reitur mapping in `vatService`, and the `/admin/bookkeeping/vat` screen that prepares the figures Halli files on skattur.is.

**Rules**
- `ADVANCE_TURNOVER_ACCOUNTS` counts the 2150 prepayment in reitur A so VSK does not move on release.
- Full rules: [../docs/ARCHITECTURE.md#9-bookkeeping--invoices-vsk-peppol-intake-settings-replay-payroll](../docs/ARCHITECTURE.md#9-bookkeeping--invoices-vsk-peppol-intake-settings-replay-payroll).

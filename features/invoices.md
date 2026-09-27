---
id: invoices
name: {is: Reikningar, en: Invoices}
domain: 9
owner: engine
status: live
flag: modules.books.enabled
paths:
  - server/models/Invoice.js
  - server/services/bookkeeping/invoiceService.js
  - server/services/bookkeepingPdf.js
  - server/services/pdfService.js
  - public/js/views/AdminInvoicesView.js
  - public/js/views/AdminInvoiceDetailView.js
  - tests/integration/booksInvoice.test.js
  - tests/unit/booksPdf.test.js
  - tests/integration/passthroughInvoice.test.js
  - tests/unit/passthrough.test.js
  - public/js/utils/passthrough.js
migrations: [099_invoice_account_link, 122_passthrough_invoice]
since: 2026-08-09
origin: null
history: [accounts-commission, review-099, migrations-100-102, passthrough-invoice-2026-09-26]
---

Sales invoices and credit notes on one number series: from shop orders (`issueInvoiceForOrder`) and from customer accounts (`createServiceInvoice`: build 50%/50%, recurring month with pro-rating, overage, and D-022's pass-through hosting/AI costs at cost + markup with no commission), each posting counter, lines, journal and books audit in one transaction. `pdfService` is the generic PDF layer shared with commission statements.

**Rules**
- Service invoices are deduplicated by partial unique indexes (one build half per account, one recurring per month, one pass-through per month — freed by a full credit, 122; overage NOT deduplicated); 23505 → 409.
- Pass-through (`kind: 'passthrough'`): the AI allowance off the period's AI lines in order, markup per line (`Math.round`), VSK once on the net total; the terms are `billing.passthrough` in the product config, never literals; no commission — the hook is the `COMMISSIONABLE_KINDS` allow-list. The admin preview (`public/js/utils/passthrough.js`) is pinned to the server rule by `tests/unit/passthrough.test.js`. See [../docs/history.d/2026-09-26-feat-passthrough-invoice.md#passthrough-invoice-2026-09-26](../docs/history.d/2026-09-26-feat-passthrough-invoice.md#passthrough-invoice-2026-09-26).
- The invoice keeps the buyer party AS AT ISSUE; `invoice_ready` (a kennitala) gates issuing.
- Owed: an "issue invoice from order" button — `issueInvoiceForOrder` has no caller.
- Full rules: [../docs/ARCHITECTURE.md#9-bookkeeping--invoices-vsk-peppol-intake-settings-replay-payroll](../docs/ARCHITECTURE.md#9-bookkeeping--invoices-vsk-peppol-intake-settings-replay-payroll).

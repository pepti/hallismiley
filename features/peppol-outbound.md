---
id: peppol-outbound
name: {is: "Peppol/UBL útflutningur", en: "Peppol UBL outbound"}
domain: 9
owner: engine
status: live
flag: modules.books.enabled
paths:
  - server/services/bookkeeping/peppol/**
  - tests/integration/booksPeppolUbl.test.js
  - tests/unit/ublInvoice.test.js
migrations: [095_books_invoice_party_structured]
since: 2026-09-06
origin: null
history: [migrations-100-102]
---

The UBL 2.1 / Peppol BIS 3 invoice emitter: structured buyer party (095), identifiers, VAT categories, XML writer and the conformance checks. Export only — Peppol inbound is owed.

**Rules**
- `peppol_complete` gates only the export; `peppol/party.js` is ONE rule with two callers; an order-path invoice cannot be UBL-exported (no BT-49).
- Full rules: [../docs/ARCHITECTURE.md#9-bookkeeping--invoices-vsk-peppol-intake-settings-replay-payroll](../docs/ARCHITECTURE.md#9-bookkeeping--invoices-vsk-peppol-intake-settings-replay-payroll).

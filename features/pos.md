---
id: pos
name: {is: Kassi, en: "Point of sale"}
domain: 9
owner: engine
status: hidden
flag: modules.pos.enabled
paths:
  - server/services/bookkeeping/posService.js
  - public/js/views/AdminPosView.js
  - public/js/components/ScanInput.js
  - public/css/scan.css
  - tests/integration/booksPos.test.js
migrations: [077_books_pos, 079_books_pos_idempotency]
since: 2026-08-09
origin: null
history: [harvest-ice-c-2026-09-24]
---

The till (077) with idempotent sales (079): cash and card sales posted straight into the books. Hidden here (`pos` in `HIDDEN_ADMIN_VIEWS`) — it is the shop-floor screen icelandicstore leads on.

**Rules**
- Full rules: [../docs/ARCHITECTURE.md#9-bookkeeping--invoices-vsk-peppol-intake-settings-replay-payroll](../docs/ARCHITECTURE.md#9-bookkeeping--invoices-vsk-peppol-intake-settings-replay-payroll).

---
id: customers-crm
name: {is: "Viðskiptavinir og minnispunktar", en: "Customers and notes"}
domain: 8
owner: engine
status: live
flag: null
paths:
  - server/routes/adminCustomerRoutes.js
  - server/routes/adminCustomerNotesRoutes.js
  - server/controllers/adminCustomerController.js
  - server/controllers/adminCustomerNoteController.js
  - server/models/Customer.js
  - server/models/CustomerNote.js
  - public/js/views/AdminCustomersView.js
  - public/js/components/CustomerNotes.js
  - public/js/services/adminCustomers.js
  - public/js/services/adminCustomerNotes.js
  - public/css/admin-customers.css
  - tests/integration/adminCustomers.test.js
  - tests/integration/adminCustomerNotes.test.js
migrations: [064_customer_notes]
since: 2026-08-09
origin: null
history: [accounts-commission]
---

The `/admin/customers` screen: every user seen as a customer (shop-derived `Customer.js`), with per-customer notes (064). Also where a new sales hire is created before a role is granted in `/admin/roles`.

**Rules**
- `Customer.js` is the shop-derived customer; `CustomerAccount.js` is the B2B customer of record — do not merge them.
- Full rules: [../docs/ARCHITECTURE.md#8-customer-accounts-commission-staff-audit](../docs/ARCHITECTURE.md#8-customer-accounts-commission-staff-audit).

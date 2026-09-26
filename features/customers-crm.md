---
id: customers-crm
name: {is: "Viðskiptavinir og minnispunktar", en: "Customers and notes"}
domain: 8
owner: engine
status: live
flag: modules.shop.enabled
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
migrations: [064_customer_notes, 117_user_address]
since: 2026-08-09
origin: null
history: [accounts-commission, harvest2-lane3-2026-09-26]
---

The `/admin/customers` screen: every user seen as a customer (shop-derived `Customer.js`), with per-customer notes (064). Also where a new sales hire is created before a role is granted in `/admin/roles`.

**Rules**
- `Customer.js` is the shop-derived customer; `CustomerAccount.js` is the B2B customer of record — do not merge them.
- One customer is read, edited and invited at `GET`/`PATCH /api/v1/admin/customers/:id` and `POST /:id/invite`, gated on the `customers` view, and the target is held to a PLAIN customer in the model (`Customer.findEditable`: role `user`, no extra role, not a party guest — else 404), so a non-admin holder of the view can never re-point a staff login's email. Contact + address (`users.address1…country`, migration 117, ice's column names) change only for the keys sent; an email change un-verifies the address and kills any reset link in flight; `user.updated` names the fields, never the values. The invite answer NEVER carries the set-password link; "Send the invite now" on Add is off by default (`send_invite: false` → `user.created`, nothing mailed). ([harvest2-lane3](../docs/history.d/2026-09-26-harvest2-lane3-users.md#harvest2-lane3-2026-09-26))
- Full rules: [../docs/ARCHITECTURE.md#8-customer-accounts-commission-staff-audit](../docs/ARCHITECTURE.md#8-customer-accounts-commission-staff-audit).

---
id: customer-accounts
name: {is: "Viðskiptareikningar", en: "Customer accounts"}
domain: 8
owner: engine
status: live
flag: modules.salesOps.enabled
paths:
  - server/routes/adminAccountRoutes.js
  - server/controllers/accountsController.js
  - server/models/CustomerAccount.js
  - server/auth/accountScope.js
  - public/js/views/AdminAccountsView.js
  - public/js/views/AdminAccountDetailView.js
  - public/js/services/accounts.js
  - public/css/admin-accounts.css
  - tests/integration/accounts.test.js
  - e2e/accounts.spec.js
  - e2e/lib/accounts.js
migrations: [098_customer_accounts, 100_customer_account_party]
since: 2026-09-07
origin: null
history: [accounts-commission, review-099, migrations-100-102]
---

The B2B customer of record (`customer_accounts`, 098) with its lifecycle (`TRANSITIONS`), owner (seller), rates, and the structured buyer party (100). `/admin/accounts` is scoped by `accountScope`: `'*'` or `allaccounts` see all, everyone else their own. Service invoices and commission events are raised from the account detail screen.

**Rules**
- Every `CustomerAccount` method takes `scope` as a REQUIRED argument and throws without one; a foreign id is 404, never 403.
- Rate fields (`build_rate_bp`/`recurring_rate_bp`) are stripped for anyone but an admin, silently.
- A skipped lifecycle step is 409; every write lands in `staff_audit_log` on the SAME client.
- The hand-off from Markaður requires `shortlist` under `FOR UPDATE` and answers 404 when not eligible.
- Full rules: [../docs/ARCHITECTURE.md#8-customer-accounts-commission-staff-audit](../docs/ARCHITECTURE.md#8-customer-accounts-commission-staff-audit).

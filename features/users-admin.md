---
id: users-admin
name: {is: "Notendaumsjón", en: "User administration"}
domain: 1
owner: engine
status: live
flag: null
paths:
  - server/routes/userRoutes.js
  - server/routes/adminRoutes.js
  - server/controllers/userController.js
  - server/controllers/adminController.js
  - public/js/views/AdminUsersView.js
  - tests/integration/users.test.js
  - server/utils/generatePassword.js
  - server/utils/placeholderEmail.js
  - server/utils/username.js
  - public/js/utils/placeholderEmail.js
  - public/js/components/OneTimeCredentials.js
  - public/js/components/ExpiryPicker.js
  - tests/integration/adminNameOnlyLogin.test.js
  - tests/unit/generatePassword.test.js
  - tests/unit/nameOnlyHelpers.test.js
  - e2e/admin-user-expiry.spec.js
migrations: [003_user_system, 065_user_invited_at]
since: 2026-08-09
origin: null
history: [review-099, ui-kit, harvest-ice-a-2026-09-24, login-expiry-2026-09-26]
---

The `/api/v1/users` self-service endpoints and the admin user list at `/admin/users`: approve, decline, disable, invite, delete, set role. `adminRoutes.js` is also the generic `/api/v1/admin` catch-all router (mount-order hazard in `docs/API.md`) and carries `email-health`. `AdminUsersView` is the converted reference for the admin UI kit.

**Logins without email** (harvested from icelandicstore #382/#397, 2026-09-24): the Customers "add" form's No-email choice makes a name-only login — a username from the name (Icelandic letters transliterated), a generated password shown ONCE (`OneTimeCredentials`), a reserved `<username>@noemail.invalid` that is never shown, searched, mailed or reset. `POST /api/v1/admin/users/:id/new-password` replaces a lost password for such a login only.

**Gildir til** (time-limited logins, 2026-09-26): the Users list shows "rennur út eftir N daga" / "útrunninn" and sets an expiry through `PATCH /api/v1/admin/users/:id/expiry`; the Customers "add" form takes one at creation (`expires_at`). Both use `components/ExpiryPicker.js` (7 / 14 / 30 days, a date, or none). The sign-in side is `auth-sessions`.

**Rules**
- The role-SET path carries the 2FA/OAuth gates via `utils/adminRole.js`; OAuth accounts are refused admin.
- An expiry is set on ANOTHER account only (never your own), must lie in the future, and is audited (`user.expiry_set` / `user.expiry_cleared`); never on an account with admin powers (`userHoldsAdminPowers`, 409 `admin_account`); reviving an expired login revokes its MCP tokens first.
- Role grant/revoke, invitation, name-only creation, disable/enable and expiry changes log to the staff audit best-effort.
- A placeholder address is never an address: ask `utils/placeholderEmail.js` before mailing, showing, searching or resetting `users.email`; `new-password` is keyed on the address, never the role, and refuses staff.
- Full rules: [../docs/ARCHITECTURE.md#1-auth-users-rbac-2fa](../docs/ARCHITECTURE.md#1-auth-users-rbac-2fa).

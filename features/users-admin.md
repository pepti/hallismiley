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
  - tests/integration/adminNameOnlyLogin.test.js
  - tests/unit/generatePassword.test.js
  - tests/unit/nameOnlyHelpers.test.js
migrations: [003_user_system, 065_user_invited_at]
since: 2026-08-09
origin: null
history: [review-099, ui-kit, harvest-ice-a-2026-09-24]
---

The `/api/v1/users` self-service endpoints and the admin user list at `/admin/users`: approve, decline, disable, invite, delete, set role. `adminRoutes.js` is also the generic `/api/v1/admin` catch-all router (mount-order hazard in `docs/API.md`) and carries `email-health`. `AdminUsersView` is the converted reference for the admin UI kit.

**Logins without email** (harvested from icelandicstore #382/#397, 2026-09-24): the Customers "add" form's No-email choice makes a name-only login — a username from the name (Icelandic letters transliterated), a generated password shown ONCE (`OneTimeCredentials`), a reserved `<username>@noemail.invalid` that is never shown, searched, mailed or reset. `POST /api/v1/admin/users/:id/new-password` replaces a lost password for such a login only.

**Rules**
- The role-SET path carries the 2FA/OAuth gates via `utils/adminRole.js`; OAuth accounts are refused admin.
- Role grant/revoke, invitation and disable/enable log to the staff audit best-effort.
- A placeholder address is never an address: ask `utils/placeholderEmail.js` before mailing, showing, searching or resetting `users.email`; `new-password` is keyed on the address, never the role, and refuses staff.
- Full rules: [../docs/ARCHITECTURE.md#1-auth-users-rbac-2fa](../docs/ARCHITECTURE.md#1-auth-users-rbac-2fa).

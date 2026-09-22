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
migrations: [003_user_system, 065_user_invited_at]
since: 2026-08-09
origin: null
history: [review-099, ui-kit]
---

The `/api/v1/users` self-service endpoints and the admin user list at `/admin/users`: approve, decline, disable, invite, delete, set role. `adminRoutes.js` is also the generic `/api/v1/admin` catch-all router (mount-order hazard in `docs/API.md`) and carries `email-health`. `AdminUsersView` is the converted reference for the admin UI kit.

**Rules**
- The role-SET path carries the 2FA/OAuth gates via `utils/adminRole.js`; OAuth accounts are refused admin.
- Role grant/revoke, invitation and disable/enable log to the staff audit best-effort.
- Full rules: [../docs/ARCHITECTURE.md#1-auth-users-rbac-2fa](../docs/ARCHITECTURE.md#1-auth-users-rbac-2fa).

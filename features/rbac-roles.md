---
id: rbac-roles
name: {is: "Hlutverk og aðgangsstýring", en: "Roles and RBAC"}
domain: 1
owner: engine
status: live
flag: null
paths:
  - server/routes/adminRolesRoutes.js
  - server/controllers/adminRolesController.js
  - server/models/Role.js
  - server/models/UserRole.js
  - server/auth/roles.js
  - server/auth/adminViews.js
  - server/auth/requireView.js
  - server/utils/adminRole.js
  - public/js/views/AdminRolesView.js
  - public/js/services/adminRoles.js
  - public/css/admin-roles.css
  - tests/integration/adminRoles.test.js
migrations: [056_dynamic_roles, 061_user_roles]
since: 2026-08-09
origin: null
history: [accounts-commission, review-099, login-expiry-2026-09-26]
---

Dynamic roles (056) with per-user role sets (061) and per-view grants: `ADMIN_VIEW_IDS` in `adminViews.js` are the grantable admin screens, `requireView(id)` is the server gate, and `/admin/roles` edits them. Seeded roles: `solufolk`, `solumadur`, `verktaki`. `PERMISSION_VIEW_IDS` (`allaccounts`) are grantable without a sidebar line.

**Rules**
- Gaining admin powers (`admin`, or a role with `*`/`users`/`roles`) clears a time-limited login's expiry in the same transaction as the grant — `changeRole`, `addMember`, a role's `view_access` edit — audited `user.expiry_cleared` reason `promoted` (`accountExpiry.clearExpiryOnPromotion`).
- `ADMIN_VIEW_IDS` stays 1:1 with `ADMIN_NAV` in `AdminSidebar.js` (`tests/unit/admin-views-parity.test.js`).
- Server-side gating first: `requireView` on the route is the security layer; SPA guards are UX (invariant 8).
- Full rules: [../docs/ARCHITECTURE.md#1-auth-users-rbac-2fa](../docs/ARCHITECTURE.md#1-auth-users-rbac-2fa).

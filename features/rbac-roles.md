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
  - tests/integration/adminRouteMatrix.test.js
migrations: [056_dynamic_roles, 061_user_roles]
since: 2026-08-09
origin: null
history: [accounts-commission, review-099, login-expiry-2026-09-26, harvest2-lane1b-2026-09-26, harvest2-lane1a-2026-09-26]
---

Dynamic roles (056) with per-user role sets (061) and per-view grants: `ADMIN_VIEW_IDS` in `adminViews.js` are the grantable admin screens, `requireView(id)` is the server gate, and `/admin/roles` edits them. Seeded roles: `solufolk`, `solumadur`, `verktaki`. `PERMISSION_VIEW_IDS` (`allaccounts`) are grantable without a sidebar line.

**Rules**
- Gaining admin powers (`admin`, or a role with `*`/`users`/`roles`) clears a time-limited login's expiry in the same transaction as the grant — `changeRole`, `addMember`, a role's `view_access` edit — audited `user.expiry_cleared` reason `promoted` (`accountExpiry.clearExpiryOnPromotion`).
- `ADMIN_VIEW_IDS` stays 1:1 with `ADMIN_NAV` in `AdminSidebar.js` (`tests/unit/admin-views-parity.test.js`).
- Server-side gating first: `requireView` on the route is the security layer; SPA guards are UX (invariant 8).
- Creating, widening and deleting a role are staff-audit events (`role.created`, `role.updated`, `role.deleted`).
- `adminRouteMatrix.test.js` reads every `/api/v1/admin…` and `/api/v1/system` mount from `app.js` and every method + path from each router, and asserts a plain `user` gets 403 and an anonymous caller 401/403 on all of them; an exemption is an entry in its `EXEMPT` map with the reason, a switched-off module's 404 is the only automatic one ([harvest2-lane1a](../docs/history.d/2026-09-26-harvest2-lane1a-security.md#harvest2-lane1a-2026-09-26); icelandicstore #416 G6).
- Full rules: [../docs/ARCHITECTURE.md#1-auth-users-rbac-2fa](../docs/ARCHITECTURE.md#1-auth-users-rbac-2fa).

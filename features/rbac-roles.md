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
  - server/utils/roleName.js
  - public/js/utils/roleLabel.js
  - tests/unit/roleName.test.js
  - e2e/admin-roles-grid.spec.js
migrations: [056_dynamic_roles, 061_user_roles, 116_role_label]
since: 2026-08-09
origin: null
history: [accounts-commission, review-099, login-expiry-2026-09-26, harvest2-lane1b-2026-09-26, harvest2-lane3-2026-09-26]
---

Dynamic roles (056) with per-user role sets (061) and per-view grants: `ADMIN_VIEW_IDS` in `adminViews.js` are the grantable admin screens, `requireView(id)` is the server gate, and `/admin/roles` edits them. Seeded roles: `solufolk`, `solumadur`, `verktaki`. `PERMISSION_VIEW_IDS` (`allaccounts`) are grantable without a sidebar line.

**Rules**
- Gaining admin powers (`admin`, or a role with `*`/`users`/`roles`) clears a time-limited login's expiry in the same transaction as the grant — `changeRole`, `addMember`, a role's `view_access` edit — audited `user.expiry_cleared` reason `promoted` (`accountExpiry.clearExpiryOnPromotion`).
- `ADMIN_VIEW_IDS` stays 1:1 with `ADMIN_NAV` in `AdminSidebar.js` (`tests/unit/admin-views-parity.test.js`).
- Server-side gating first: `requireView` on the route is the security layer; SPA guards are UX (invariant 8).
- Creating, widening and deleting a role are staff-audit events (`role.created`, `role.updated`, `role.deleted`); a rename rides `role.updated` (`label_before`/`label_after`).
- A role is created from its display name (`roles.label`, migration 116); the server derives the slug (`utils/roleName.js`: folded, `-2`/`-3` on collision, insert-and-retry) and the slug is NEVER renamed. Labels are NFKC-cleaned, Latin script, 2–30 chars, unique after folding (against every other role's label, or its slug when it has none). Reserved names — the built-ins and a folded back-office deny-list (admin*, administrator, staff, system, kerfi, stjórnandi, starfsmaður, root, owner, support, notandi…) — are refused for label AND slug. The built-ins' names are i18n (`adminRoles.builtin.*`); their label is not editable. ([harvest2-lane3](../docs/history.d/2026-09-26-harvest2-lane3-users.md#harvest2-lane3-2026-09-26))
- `/admin/roles` is ONE grid: rows = offered grantable views grouped by sidebar group, columns = roles; `admin` all-on + locked, `user` all-off + locked (the server refuses any view ADDED to `user`, which every account holds), `roles` never a row. One PATCH per changed role from the save bar, which counts the DISTINCT people reached.
- Deleting a role someone holds is 409 `roleInUse` with `count` (`UserRole.holderCount`).
- Every surface names a role through `public/js/utils/roleLabel.js` — never the slug.
- Full rules: [../docs/ARCHITECTURE.md#1-auth-users-rbac-2fa](../docs/ARCHITECTURE.md#1-auth-users-rbac-2fa).

---
id: admin-shell
name: {is: "Stjórnborðsrammi", en: "Admin shell"}
domain: 2
owner: engine
status: live
flag: null
paths:
  - server/routes/adminNavRoutes.js
  - server/models/AdminNavConfig.js
  - public/js/views/AdminView.js
  - public/js/views/AdminProjectsView.js
  - public/js/components/AdminSidebar.js
  - public/js/components/adminNavLayout.js
  - public/js/components/adminSurface.js
  - public/js/services/adminNav.js
  - public/js/services/buildInfo.js
  - public/css/admin-shell.css
  - public/css/admin-dashboard.css
  - tests/integration/adminNavConfig.test.js
  - tests/integration/admin.test.js
  - tests/unit/admin-surface-parity.test.js
  - tests/unit/admin-views-parity.test.js
  - e2e/admin.spec.js
  - e2e/admin-surface.spec.js
  - e2e/admin-sidebar-scroll.spec.js
  - e2e/admin-nav-colors.spec.js
migrations: [053_admin_nav_config]
since: 2026-08-09
origin: null
history: [r1, admin-reshape, harvest-2]
---

The sidebar (`ADMIN_NAV`, grouped IA with per-admin layout and 12 row tints saved in `admin_nav_config`), the company overview at `/admin`, and surface hiding: `HIDDEN_ADMIN_VIEWS` in `adminSurface.js` hides lines for `'*'` holders while the routes and ids stay live and grantable.

**Rules**
- Hide, never delete: `HIDDEN_ADMIN_VIEWS` applies only to `'*'` holders; an all-hidden group renders no header.
- Dashboard cards sit over EXISTING endpoints, each gated on the view its endpoint demands.
- Every admin view carries `destroy()` and a stale-paint sequence guard.
- Full rules: [../docs/ARCHITECTURE.md#2-admin-shell--sidebar-dashboard-surface-hiding-ui-kit](../docs/ARCHITECTURE.md#2-admin-shell--sidebar-dashboard-surface-hiding-ui-kit).

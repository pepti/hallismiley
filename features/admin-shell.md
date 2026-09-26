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
  - server/routes/adminHomeRoutes.js
  - server/services/adminHome.js
  - public/css/admin-idag.css
  - tests/integration/adminHome.test.js
  - e2e/admin-home.spec.js
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
  - public/js/services/pageWidth.js
  - public/js/components/PageWidthControl.js
  - public/js/components/AsideWidthControl.js
  - public/js/components/widthMenu.js
  - tests/integration/pageWidth.test.js
  - tests/unit/pageWidth.client.test.js
  - e2e/admin-page-width.spec.js
migrations: [053_admin_nav_config, 111_user_ui_prefs]
since: 2026-08-09
origin: null
history: [r1, admin-reshape, harvest-2, identity-seam-2026-09-22, harvest-ice-b-2026-09-24, admin-home-idag-2026-09-26]
---

The sidebar (`ADMIN_NAV`, grouped IA with per-admin layout and 12 row tints saved in `admin_nav_config`), the admin home "Í dag" at `/admin` (one read, `GET /api/v1/admin/home`: Bíður þín, Staðan, Nýjast, Fyrstu skrefin; since 2026-09-26, replacing the card overview), and surface hiding: `HIDDEN_ADMIN_VIEWS` in `adminSurface.js` hides lines for `'*'` holders while the routes and ids stay live and grantable. The SET is the product's — `identity.surface.hiddenAdminViews` in `config/client.json`, read through `utils/identity.js`.

**Layout preferences per account** (harvested from icelandicstore, 2026-09-24; migration 111): the page-width icon on the sidebar's Breyta row (Venjuleg 1280 / Breið 1920 / Allur skjárinn, per page or all pages, Mjúk hreyfing) and the side-column width on the order detail page (Mjór / Miðlungs / Breiður). `users.page_widths`, `page_width_motion`, `aside_widths` ride on the session like `theme`; `PUT /api/v1/users/me/{page-width, page-width-motion, aside-width}`. Migration 111 also carries `users.cookie_consent` (the analytics feature's).

**Rules**
- Hide, never delete: `HIDDEN_ADMIN_VIEWS` applies only to `'*'` holders; an all-hidden group renders no header. The ids come from the identity seam, never a literal in `adminSurface.js`; `admin-surface-parity.test.js` checks the engine defaults AND this instance's resolved list against `ADMIN_VIEW_IDS`.
- The admin home is ONE role-gated endpoint (`/api/v1/admin/home`, session + the `dashboard` view): every block is computed server-side only for a view the role holds (`resolveViews`, minus switched-off modules, minus the product's hidden views for a `'*'` holder), and a key the role cannot see is ABSENT from the JSON. A failing source drops its blocks and the answer is still 200 with `errors`. Amounts integer ISK, times ISO UTC, no labels from the server.
- Every admin view carries `destroy()` and a stale-paint sequence guard.
- A page's width key is the router's matched pattern; the client and server width lists move together; a pick is one atomic jsonb UPDATE.
- Full rules: [../docs/ARCHITECTURE.md#2-admin-shell--sidebar-dashboard-surface-hiding-ui-kit](../docs/ARCHITECTURE.md#2-admin-shell--sidebar-dashboard-surface-hiding-ui-kit).

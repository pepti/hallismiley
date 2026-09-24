---
id: change-requests
name: {is: "Breytingarbeiðnir", en: "Change requests"}
domain: 16
owner: engine
status: live
flag: null
paths:
  - server/routes/changeRequestRoutes.js
  - server/routes/adminChangeRequestRoutes.js
  - server/controllers/changeRequestController.js
  - server/models/ChangeRequest.js
  - server/middleware/changeRequestGate.js
  - public/js/views/AdminChangeRequestsView.js
  - public/js/components/ChangeRequestWidget.js
  - public/css/admin-change-requests.css
  - public/css/test-env.css
  - tests/integration/changeRequests.test.js
  - e2e/admin-feedback-switch.spec.js
migrations: [052_change_requests]
since: 2026-08-09
origin: null
history: [harvest-2, admin-reshape, test-chrome-admin, rk-feed-2026-09-23]
---

The feedback widget (screenshot + note, 5 MB body) and the `/admin/change-requests` inbox (`feedback` view), plus the TEST chrome (badge, glow) that marks a non-production stack for admins.

**Rules**
- The gate = admin AND (non-prod app-env OR `change_requests.enabled`); it answers 404, not 403.
- The TEST chrome is admins only on every stack; `themePrefs.getEffectiveEnv()` is the one client answer.
- While mounted the launcher sets `body.has-cr-widget` and `--cr-widget-clearance`; a page's own fixed bottom-right bar adds the variable to its `bottom` instead of sharing the corner.
- The 5 MB submit body is parsed after the limiter, the gate and CSRF, then sanitized ([history](../docs/HISTORY.md#ready-and-import-order-2026-09-23)).
- Full rules: [../docs/ARCHITECTURE.md#16-change-requests--breytingarbeiðnir](../docs/ARCHITECTURE.md#16-change-requests--breytingarbeiðnir).

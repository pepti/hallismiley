---
id: analytics
name: {is: "Vefmælingar", en: Analytics}
domain: 13
owner: engine
status: live
flag: null
paths:
  - server/routes/analyticsRoutes.js
  - server/routes/analyticsAdminRoutes.js
  - server/controllers/analyticsController.js
  - server/models/Analytics.js
  - server/services/analyticsSalt.js
  - public/js/views/AdminAnalyticsView.js
  - public/js/analytics.js
  - public/js/consent.js
  - public/css/analytics-admin.css
  - tests/integration/analytics.test.js
  - tests/unit/analyticsSalt.test.js
migrations: [046_analytics]
since: 2026-08-09
origin: null
history: []
---

First-party, cookie-consent-gated page analytics (046): a salted daily visitor hash, page views and the `/admin/analytics` charts (drawn through `chartTheme.js`).

**Rules**
- Full rules: [../docs/ARCHITECTURE.md#13-monitoring--event-logs-metrics-analytics](../docs/ARCHITECTURE.md#13-monitoring--event-logs-metrics-analytics).

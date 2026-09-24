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
  - public/js/services/cookieConsent.js
  - tests/integration/cookieConsent.test.js
  - tests/unit/cookieConsent.client.test.js
  - e2e/cookie-consent-account.spec.js
migrations: [046_analytics]
since: 2026-08-09
origin: null
history: [harvest-ice-b-2026-09-24]
---

First-party, cookie-consent-gated page analytics (046): a salted daily visitor hash, page views and the `/admin/analytics` charts (drawn through `chartTheme.js`).

The cookie banner follows the account (icelandicstore #411, 2026-09-24): `users.cookie_consent` (migration 111, claimed by admin-shell) holds a signed-in answer, `services/cookieConsent.js` adopts or saves it, `consent.js` waits for `consent:ready`, "declined" wins, and the banner's colours are theme tokens.

**Rules**
- An account "accepted" never overrides a browser that declined; the banner never shows before `consent:ready` (or its 4 s backstop).
- Full rules: [../docs/ARCHITECTURE.md#13-monitoring--event-logs-metrics-analytics](../docs/ARCHITECTURE.md#13-monitoring--event-logs-metrics-analytics).
